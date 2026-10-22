// lib/briefing/service.ts — the two job bodies (docs/02 §3.4, ADR-010).
// Inngest functions in inngest/daily-briefing.ts are thin adapters over
// these, so the logic is testable with a fake `step` and no Inngest server.
import type { LanguageModel } from 'ai';
import { NonRetriableError } from 'inngest';
import { getUserTimeZone } from '@/lib/preferences/repo';
import type { Logger } from '@/lib/observability/logger';
import { briefingDue, safeZone } from './schedule';
import { failedSourcesOf, gatherContext, type BriefingContext, type GatherDeps } from './context';
import { generateBriefingItems, type GenerationResult } from './generate';
import { briefingEvent, type BriefingEventPayload } from './events';
import {
  claimRun,
  claimStalePendingRuns,
  createPendingRuns,
  existingRunKeys,
  failStuckRuns,
  finishRun,
  listPreferencePage,
  markRunFailed,
  type PendingRunInput,
} from './repo';
import { BriefingRequestedSchema, type BriefingRequested } from './types';

/** Minimal subset of Inngest's step tools used by the jobs. */
export interface StepLike {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sendEvent(id: string, events: BriefingEventPayload[]): Promise<unknown>;
}

export interface JobDeps extends GatherDeps {
  now: () => Date;
  model: () => LanguageModel;
  modelId: string;
  logger: Logger;
}

export const SCHEDULER_PAGE_SIZE = 500;
export const SEND_CHUNK = 100;
export const STALE_PENDING_MS = 10 * 60_000;
export const STUCK_RUNNING_MS = 30 * 60_000;
export const GENERATE_RETRIES = 3;

// ───────────────────────── scheduler (BRIEF-001) ─────────────────────────

export interface DueRun {
  userId: string;
  localDate: string;
}

/**
 * Scans preferences and creates a PENDING run for every user whose local
 * time has passed their briefing time and who has no run for that local
 * date. Returns only the runs created by this call.
 */
export async function createDueRuns(now: Date, opts: { pageSize?: number } = {}): Promise<DueRun[]> {
  const created: DueRun[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await listPreferencePage(after, opts.pageSize ?? SCHEDULER_PAGE_SIZE);
    if (page.length === 0) break;
    after = page[page.length - 1].userId;
    const due: PendingRunInput[] = [];
    for (const p of page) {
      const r = briefingDue(now, p);
      if (r.due) due.push({ userId: p.userId, localDate: r.localDate, timeZone: safeZone(p.timeZone), trigger: 'SCHEDULED' });
    }
    const existing = await existingRunKeys(due);
    created.push(...(await createPendingRuns(due.filter((d) => !existing.has(`${d.userId}|${d.localDate}`)))));
    if (page.length < (opts.pageSize ?? SCHEDULER_PAGE_SIZE)) break;
  }
  return created;
}

export interface SchedulerResult {
  emitted: number;
  reemitted: number;
  failedStuck: number;
}

export async function runSchedulerTick(step: StepLike, deps: Pick<JobDeps, 'now' | 'logger'>): Promise<SchedulerResult> {
  const nowIso = await step.run('clock', async () => deps.now().toISOString());
  const now = new Date(nowIso);
  const fresh = await step.run('find-due', () => createDueRuns(now));
  const failedStuck = await step.run('fail-stuck', () => failStuckRuns(new Date(now.getTime() - STUCK_RUNNING_MS), now));
  const stale = await step.run('stale-pending', () => claimStalePendingRuns(new Date(now.getTime() - STALE_PENDING_MS), now));

  const events = [
    ...fresh.map((r) => briefingEvent(r.userId, r.localDate, { trigger: 'SCHEDULED' })),
    ...stale.map((r) => briefingEvent(r.userId, r.localDate, { trigger: r.attempts > 0 ? 'RETRY' : 'SCHEDULED', attempts: r.attempts })),
  ];
  for (let i = 0; i < events.length; i += SEND_CHUNK) {
    await step.sendEvent(`fan-out-${i / SEND_CHUNK}`, events.slice(i, i + SEND_CHUNK));
  }
  deps.logger.info('briefing.scheduler_tick', { emitted: fresh.length, reemitted: stale.length, failedStuck });
  return { emitted: fresh.length, reemitted: stale.length, failedStuck };
}

// ───────────────────────── per-user generation (BRIEF-002..006) ─────────────────────────

/** Validates the event payload; a malformed one is rejected without retries and touches no user. */
export function parseBriefingEvent(data: unknown): BriefingRequested {
  const parsed = BriefingRequestedSchema.safeParse(data);
  if (!parsed.success) throw new NonRetriableError('Invalid briefing/generate.requested payload');
  return parsed.data;
}

export interface GenerateInput {
  eventData: unknown;
  runId: string;
  /** 0-based Inngest attempt. */
  attempt: number;
  maxAttempts?: number;
}

export type GenerateOutcome =
  | { status: 'skipped'; reason: 'already_claimed' }
  | { status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'; itemCount: number; failedSources: string[]; generator: GenerationResult['generator'] };

/** Error names are safe to store; messages are not (they can carry provider detail). */
export function errorCodeOf(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'UnknownError';
}

export async function runBriefingGenerate(input: GenerateInput, step: StepLike, deps: JobDeps): Promise<GenerateOutcome> {
  const event = parseBriefingEvent(input.eventData);
  const { userId, localDate } = event;
  const log = deps.logger.child({ userId, localDate, inngestRunId: input.runId });
  const maxAttempts = input.maxAttempts ?? GENERATE_RETRIES + 1;

  const claim = await step.run('claim', async () => {
    const timeZone = safeZone(await getUserTimeZone(userId));
    const now = deps.now();
    const run = await claimRun({ userId, localDate, timeZone, inngestRunId: input.runId, trigger: event.trigger, requestId: event.requestId, now });
    return run ? { timeZone, startedAt: (run.startedAt ?? now).toISOString() } : null;
  });
  if (!claim) {
    log.info('briefing.skipped', { reason: 'already_claimed' });
    return { status: 'skipped', reason: 'already_claimed' };
  }

  const ctx: BriefingContext = await step.run('gather', () =>
    gatherContext(
      { userId, localDate, timeZone: claim.timeZone, now: deps.now(), finalAttempt: input.attempt >= maxAttempts - 1 },
      { google: deps.google, embed: deps.embed, logger: log },
    ),
  );

  const failedSources = failedSourcesOf(ctx);
  const google = [ctx.sourceStatus.gmail?.status, ctx.sourceStatus.calendar?.status];
  const allExternalFailed = google.every((s) => s === 'failed');
  const nothingLocal = ctx.tasks.length === 0 && ctx.reminders.length === 0;

  const generated = await step.run('generate', async () => {
    if (allExternalFailed && nothingLocal) return null;
    return generateBriefingItems(ctx, { model: deps.model, modelId: deps.modelId, logger: log });
  });

  const outcome = await step.run('persist', async () => {
    const now = deps.now();
    const status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' = generated === null ? 'FAILED' : failedSources.length > 0 ? 'PARTIAL' : 'SUCCEEDED';
    const metrics = {
      itemCount: generated?.items.length ?? 0,
      generator: generated?.generator ?? null,
      fallbackReason: generated?.fallbackReason ?? null,
      durationMs: now.getTime() - new Date(claim.startedAt).getTime(),
      sources: Object.fromEntries(Object.entries(ctx.sourceStatus).map(([k, v]) => [k, { status: v.status, count: v.count ?? 0 }])),
      ...(generated?.grounding ?? { droppedUngrounded: 0 }),
    };
    const ok = await finishRun({
      userId,
      localDate,
      inngestRunId: input.runId,
      status,
      failedSources,
      sourceStatus: ctx.sourceStatus,
      errorCode: status === 'FAILED' ? 'ALL_SOURCES_FAILED' : null,
      model: generated ? (generated.generator === 'fallback' ? 'deterministic-fallback' : generated.modelId) : null,
      inputTokens: generated?.inputTokens ?? null,
      outputTokens: generated?.outputTokens ?? null,
      metrics,
      items: generated?.items,
      now,
    });
    return { ok, status };
  });

  if (!outcome.ok) {
    log.warn('briefing.finish_lost_claim', {});
    return { status: 'skipped', reason: 'already_claimed' };
  }
  const level = outcome.status === 'SUCCEEDED' ? 'info' : 'warn';
  log[level]('briefing.finished', { status: outcome.status, failedSources, itemCount: generated?.items.length ?? 0, generator: generated?.generator ?? null });
  return { status: outcome.status, itemCount: generated?.items.length ?? 0, failedSources, generator: generated?.generator ?? 'fallback' };
}

/** onFailure (retries exhausted): mark the run FAILED with the error class only. */
export async function handleBriefingFailure(originalEventData: unknown, error: unknown, deps: Pick<JobDeps, 'now' | 'logger'>): Promise<void> {
  const parsed = BriefingRequestedSchema.safeParse(originalEventData);
  if (!parsed.success) return;
  const code = errorCodeOf(error);
  const marked = await markRunFailed(parsed.data.userId, parsed.data.localDate, code, deps.now());
  deps.logger.error('briefing.failed', { userId: parsed.data.userId, localDate: parsed.data.localDate, errorCode: code, marked });
}

