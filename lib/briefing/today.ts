// lib/briefing/today.ts — read API for the Today page (ADR-010, BRIEF-007,
// FR-309..FR-312). No model call happens here: it reads stored rows and, at
// most, enqueues an event.
import { getUserTimeZone } from '@/lib/preferences/repo';
import { logger } from '@/lib/observability/logger';
import { floatingToLocalDate, localDateOf, type LocalDate } from '@/lib/time';
import { briefingEvent, sendBriefingEvents } from './events';
import { createPendingRuns, getLatestBriefingBefore, getRun, requeueRun, type DailyBriefing } from './repo';
import { safeZone } from './schedule';
import { BriefingItemSchema, type BriefingItem, type EnsureQueuedResult, type TodayBriefing } from './types';

export type { BriefingItem, TodayBriefing, EnsureQueuedResult };

export const STALE_AFTER_MS = 12 * 60 * 60_000;
/** Initial run + 3 retries per local day (FR-310). */
export const MAX_RUN_ATTEMPTS = 4;
/** A FAILED run is re-enqueued from page load at most this often. */
export const PAGE_LOAD_RETRY_INTERVAL_MS = 10 * 60_000;
/** Manual refresh: at most once per this interval per user. */
export const REFRESH_INTERVAL_MS = 30 * 60_000;

async function userToday(userId: string, now: Date): Promise<{ timeZone: string; localDate: LocalDate }> {
  const timeZone = safeZone(await getUserTimeZone(userId));
  return { timeZone, localDate: localDateOf(now, timeZone) };
}

function parseItems(raw: unknown): BriefingItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefingItem[] = [];
  for (const item of raw) {
    const parsed = BriefingItemSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data as BriefingItem);
  }
  return out;
}

export function isBriefingStale(b: { localDate: LocalDate; generatedAt: Date }, today: LocalDate, now: Date): boolean {
  return b.localDate < today || now.getTime() - b.generatedAt.getTime() > STALE_AFTER_MS;
}

function present(daily: DailyBriefing, failedSources: string[], today: LocalDate, now: Date): NonNullable<TodayBriefing['briefing']> {
  const localDate = floatingToLocalDate(daily.localDate);
  return {
    localDate,
    generatedAt: daily.generatedAt.toISOString(),
    isStale: isBriefingStale({ localDate, generatedAt: daily.generatedAt }, today, now),
    partialSources: [...failedSources],
    items: parseItems(daily.items),
  };
}

/**
 * Today's briefing for `userId`:
 * - ready      SUCCEEDED/PARTIAL run with a stored briefing
 * - preparing  run PENDING/RUNNING (a previous briefing may be included)
 * - failed     run FAILED (a previous briefing may be included)
 * - none       no run for today (the latest briefing of the last 7 days may be included, stale)
 */
export async function getTodayBriefing(userId: string, now: Date = new Date()): Promise<TodayBriefing> {
  const { localDate } = await userToday(userId, now);
  const run = await getRun(userId, localDate);

  if (run?.briefing) {
    const briefing = present(run.briefing, run.failedSources, localDate, now);
    const status = run.status === 'SUCCEEDED' || run.status === 'PARTIAL' ? 'ready' : run.status === 'FAILED' ? 'failed' : 'preparing';
    return { status, briefing };
  }

  const previous = await getLatestBriefingBefore(userId, localDate);
  const briefing = previous ? present(previous, previous.briefingRun.failedSources, localDate, now) : undefined;
  if (!run) return { status: 'none', ...(briefing ? { briefing } : {}) };
  if (run.status === 'PENDING' || run.status === 'RUNNING') return { status: 'preparing', ...(briefing ? { briefing } : {}) };
  // FAILED, or a finished run without a stored briefing (legacy rows).
  return { status: 'failed', ...(briefing ? { briefing } : {}) };
}

async function emit(userId: string, localDate: LocalDate, attempts: number, trigger: 'PAGE_LOAD' | 'RETRY', requestId?: string): Promise<void> {
  try {
    // A retry needs its own idempotency key, distinct from the day's first run.
    const key = trigger === 'RETRY' ? Math.max(1, attempts) : 0;
    await sendBriefingEvents([briefingEvent(userId, localDate, { attempts: key, trigger, requestId })]);
  } catch (err) {
    // The PENDING row stays; the scheduler re-emits stale PENDING runs (STALE_PENDING_MS).
    logger.error('briefing.enqueue_failed', { userId, localDate, errorName: (err as Error)?.name });
  }
}

/**
 * Called when Today loads without a briefing (ADR-010: enqueue, not a button).
 * Idempotent: concurrent calls create one run and send one event. A FAILED
 * run is retried at most once per PAGE_LOAD_RETRY_INTERVAL_MS and within the
 * daily attempt budget.
 */
export async function ensureTodayBriefingQueued(userId: string, now: Date = new Date()): Promise<EnsureQueuedResult> {
  const { timeZone, localDate } = await userToday(userId, now);
  let run = await getRun(userId, localDate);
  if (!run) {
    const created = await createPendingRuns([{ userId, localDate, timeZone, trigger: 'PAGE_LOAD' }]);
    if (created.length > 0) {
      await emit(userId, localDate, 0, 'PAGE_LOAD');
      return 'queued';
    }
    run = await getRun(userId, localDate);
    if (!run) return 'exists';
  }
  if (run.status === 'PENDING' || run.status === 'RUNNING') return 'running';
  if (run.status === 'FAILED') {
    const requeued = await requeueRun({
      userId,
      localDate,
      statuses: ['FAILED'],
      changedBefore: new Date(now.getTime() - PAGE_LOAD_RETRY_INTERVAL_MS),
      maxAttempts: MAX_RUN_ATTEMPTS,
      trigger: 'RETRY',
    });
    if (requeued) {
      await emit(userId, localDate, requeued.attempts, 'RETRY');
      return 'queued';
    }
  }
  return 'exists';
}

export type RefreshOutcome =
  | { outcome: 'queued' }
  | { outcome: 'running' }
  | { outcome: 'fresh' }
  | { outcome: 'exhausted' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number };

/**
 * Manual refresh (POST /api/briefing/today/refresh). Regenerates into the
 * same BriefingRun row (FR-310): allowed for FAILED or PARTIAL runs, and for
 * a SUCCEEDED run only once it is stale (FR-311: no regenerate of a fresh,
 * successful briefing). At most once per REFRESH_INTERVAL_MS, never while a
 * run is pending or running, and within MAX_RUN_ATTEMPTS per day.
 */
export async function requestBriefingRefresh(userId: string, now: Date = new Date(), requestId?: string): Promise<RefreshOutcome> {
  const { timeZone, localDate } = await userToday(userId, now);
  const run = await getRun(userId, localDate);
  if (!run) {
    const created = await createPendingRuns([{ userId, localDate, timeZone, trigger: 'PAGE_LOAD', requestId }]);
    if (created.length > 0) {
      await emit(userId, localDate, 0, 'PAGE_LOAD', requestId);
      return { outcome: 'queued' };
    }
    return { outcome: 'running' };
  }
  if (run.status === 'PENDING' || run.status === 'RUNNING') return { outcome: 'running' };
  if (run.status === 'SUCCEEDED') {
    const generatedAt = run.briefing?.generatedAt ?? run.finishedAt ?? run.updatedAt;
    if (!isBriefingStale({ localDate, generatedAt }, localDate, now)) return { outcome: 'fresh' };
  }
  if (run.attempts >= MAX_RUN_ATTEMPTS) return { outcome: 'exhausted' };
  const nextAllowed = run.updatedAt.getTime() + REFRESH_INTERVAL_MS;
  if (nextAllowed > now.getTime()) return { outcome: 'rate_limited', retryAfterSeconds: Math.ceil((nextAllowed - now.getTime()) / 1000) };

  const requeued = await requeueRun({
    userId,
    localDate,
    statuses: [run.status],
    changedBefore: new Date(now.getTime() - REFRESH_INTERVAL_MS),
    maxAttempts: MAX_RUN_ATTEMPTS,
    trigger: 'RETRY',
    requestId,
  });
  if (!requeued) return { outcome: 'running' };
  await emit(userId, localDate, requeued.attempts, 'RETRY', requestId);
  return { outcome: 'queued' };
}
