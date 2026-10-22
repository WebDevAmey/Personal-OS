// lib/commands/service.ts — the command pipeline behind POST /api/command
// and /api/command/confirm (docs/04 §3, §9, §11).
import { contextMessage, MAX_STEPS, PROMPT_VERSION, runModel, type ModelRunResult } from '@/lib/ai/orchestrator';
import { modelId } from '@/lib/ai/provider';
import type { AgentRunStatus, Prisma } from '@/lib/generated/prisma/client';
import { logger } from '@/lib/observability/logger';
import { getPreferences } from '@/lib/preferences/repo';
import { ConflictError, NotFoundError, ValidationError, getTask, undoBatch, undoEvent } from '@/lib/tasks/repo';
import { openClarification, resumeClarification } from './clarify';
import type { CommandDeps } from './deps';
import { cancelProposal, executeProposal } from './execute';
import { buildResponse, executedMessage } from './narrate';
import { clarifyUnresolved, type ClarificationArgs } from './proposals';
import {
  claimRun,
  executedTargetsOfRun,
  expireRunProposals,
  failStaleRun,
  findRunByRequestId,
  finishRun,
  getProposal,
  getRun,
  googleConnection,
  reclaimFailedRun,
  STALE_RUN_MS,
  type AgentRun,
} from './repo';
import type { RunState } from './run-state';
import { mentionsAntecedent } from './resolve-task';
import { summarizeTask } from './summaries';
import {
  CommandRequest,
  ConfirmRequest,
  UndoRequest,
  ERROR_CODES,
  errorBody,
  MAX_INPUT_CHARS,
  type CommandResponse,
} from './types';

const ANTECEDENT_WINDOW_MS = 10 * 60_000;
const DAILY_LIMIT_MESSAGE = "You've used today's command allowance — try again tomorrow.";

const INTENT: Record<string, string> = {
  propose_create_task: 'task.create',
  propose_update_task: 'task.reschedule',
  propose_complete_task: 'task.complete',
  propose_reopen_task: 'task.reopen',
  propose_snooze_task: 'task.snooze',
  propose_delete_task: 'task.delete',
  propose_bulk_update_tasks: 'task.bulk',
  propose_create_reminder: 'reminder.create',
  propose_email_draft: 'email.draft',
  save_memory: 'memory.save',
  list_agenda: 'agenda.query',
  list_calendar_events: 'calendar.query',
  search_tasks: 'task.query',
  get_task: 'task.query',
  resolve_task: 'task.query',
  search_email: 'email.query',
  get_email: 'email.query',
  search_memory: 'memory.query',
  search_web: 'web.query',
  get_preferences: 'prefs.query',
};

export function intentOf(toolNames: string[]): string {
  const propose = toolNames.find((t) => t.startsWith('propose_') || t === 'save_memory');
  const first = propose ?? toolNames[0];
  return first ? (INTENT[first] ?? 'unsupported') : 'chat.answer';
}

function runStatusFor(body: CommandResponse): AgentRunStatus {
  switch (body.kind) {
    case 'clarification':
      return 'NEEDS_CLARIFICATION';
    case 'proposal':
      return 'AWAITING_CONFIRMATION';
    case 'error':
      return 'FAILED';
    default:
      return 'SUCCEEDED';
  }
}

export interface CommandMeta {
  requestId?: string;
}

/** Validates the body; INPUT_TOO_LONG is distinguished from other shape errors (§12). */
export function parseCommandRequest(body: unknown): { ok: true; req: CommandRequest } | { ok: false; res: CommandResponse } {
  if (body && typeof body === 'object' && typeof (body as { input?: unknown }).input === 'string' && (body as { input: string }).input.trim().length > MAX_INPUT_CHARS) {
    return { ok: false, res: errorBody('INPUT_TOO_LONG') };
  }
  const parsed = CommandRequest.safeParse(body);
  return parsed.success ? { ok: true, req: parsed.data } : { ok: false, res: errorBody('INVALID_INPUT') };
}

function replay(run: AgentRun): CommandResponse {
  return (run.result as unknown as CommandResponse) ?? errorBody('INTERNAL', { runId: run.id });
}

async function buildState(userId: string, run: AgentRun, req: CommandRequest, deps: CommandDeps, meta: CommandMeta, now: Date): Promise<{ state: RunState; focused: { handle: string; title: string } | null }> {
  const prefs = await getPreferences(userId);
  const state: RunState = {
    userId,
    runId: run.id,
    input: req.input ?? '',
    source: req.source === 'voice' ? 'VOICE' : 'COMMAND',
    now,
    prefs: {
      timeZone: prefs.timeZone,
      workdayStartsAt: prefs.workdayStart,
      workdayEndsAt: prefs.workdayEnd,
      lunchEndsAt: prefs.lunchEndsAt,
      weekStartsOn: prefs.weekStart,
      locale: prefs.locale,
    },
    deps,
    requestId: meta.requestId,
    handles: new Map(),
    handleOf: new Map(),
    taint: new Set(),
    outcomes: [],
    trace: [],
    outputBytes: 0,
    needsReconnect: false,
    googleStatus: await googleConnection(userId),
    pinned: new Map(),
    antecedentTaskIds: [],
    sources: [],
    toolNames: [],
    unresolved: new Map(),
  };

  // Step 3: the focused task must be the user's own; an unknown id is dropped silently.
  let focused: { handle: string; title: string } | null = null;
  if (req.context?.focusedTaskId) {
    try {
      const task = await getTask(userId, req.context.focusedTaskId);
      state.focusedTaskId = task.id;
      // The focused task counts as the user's own target only when their words
      // refer to it ("mark it done"); otherwise a run that reads an email cannot
      // act on it without confirmation (SEC-R-001).
      const s = await summarizeTask(state, task, { userDerived: mentionsAntecedent(state.input) });
      focused = { handle: s.handle, title: s.title };
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  const previousRunId = req.context?.previousRunId;
  if (previousRunId && !state.focusedTaskId) {
    const prev = await getRun(userId, previousRunId);
    if (prev && now.getTime() - prev.createdAt.getTime() < ANTECEDENT_WINDOW_MS) {
      state.antecedentTaskIds = await executedTargetsOfRun(userId, prev.id);
    }
  }
  return { state, focused };
}

function metrics(state: RunState, model: ModelRunResult | null, startedAt: number, body: CommandResponse) {
  return {
    intent: intentOf(state.toolNames),
    stepCount: model?.steps ?? 0,
    toolCalls: state.toolNames as unknown as Prisma.InputJsonValue,
    toolTrace: {
      calls: state.trace,
      modelLatencyMs: model?.modelLatencyMs ?? null,
      cachedInputTokens: model?.cachedInputTokens ?? null,
      outcome: body.kind,
      ...(body.kind === 'error' ? { errorCode: body.error.code } : {}),
      taintSources: [...state.taint],
    } as unknown as Prisma.InputJsonValue,
    latencyMs: Date.now() - startedAt,
    inputTokens: model?.inputTokens ?? null,
    outputTokens: model?.outputTokens ?? null,
    tokenCost: model && model.inputTokens !== null && model.outputTokens !== null ? model.inputTokens + model.outputTokens : null,
  };
}

/** POST /api/command after authentication and CSRF checks. */
export async function handleCommand(userId: string, body: unknown, deps: CommandDeps, meta: CommandMeta = {}): Promise<CommandResponse> {
  const startedAt = Date.now();
  const parsed = parseCommandRequest(body);
  if (!parsed.ok) return parsed.res;
  const req = parsed.req;
  const now = deps.now();

  // Replay / in-progress before spending rate-limit budget (§11.1).
  const existing = await findRunByRequestId(userId, req.clientRequestId);
  let run: AgentRun | null = null;
  if (existing) {
    if (existing.status === 'RUNNING') {
      if (now.getTime() - existing.createdAt.getTime() > STALE_RUN_MS) {
        const stale = errorBody('INTERNAL', { runId: existing.id, message: 'That request was interrupted — please send it again.' });
        await failStaleRun(userId, existing.id, now, stale as unknown as Prisma.InputJsonValue);
        return stale;
      }
      return errorBody('REQUEST_IN_PROGRESS', { runId: existing.id, retryAfterMs: 1000 });
    }
    const stored = replay(existing);
    const retryable = stored.kind === 'error' && ERROR_CODES[stored.error.code].retryable && existing.errorCode !== 'STALE_RUN';
    if (!retryable) {
      logger.info('command.replay', { runId: existing.id });
      return stored;
    }
    if (!(await reclaimFailedRun(userId, existing.id))) return errorBody('REQUEST_IN_PROGRESS', { runId: existing.id, retryAfterMs: 1000 });
    run = existing;
  }

  const limit = await deps.rateLimit(userId, 'ai');
  // Per-user daily budget behind the per-minute window (SEC-R-003).
  const daily = limit.allowed ? await deps.rateLimit(userId, 'command_daily') : null;
  if (!limit.allowed || (daily && !daily.allowed)) {
    const denied = daily && !daily.allowed ? daily : limit;
    const message = daily && !daily.allowed ? DAILY_LIMIT_MESSAGE : undefined;
    if (run) await finishRun(userId, run.id, { status: 'RATE_LIMITED', result: errorBody('RATE_LIMITED', { message }) as unknown as Prisma.InputJsonValue, errorCode: 'RATE_LIMITED', finishedAt: now });
    return errorBody('RATE_LIMITED', { retryAfterMs: denied.retryAfterMs ?? 60_000, message });
  }

  if (!run) {
    let clarifiesRunId: string | null = null;
    if (req.replyTo) {
      const prior = await getRun(userId, req.replyTo.runId);
      if (!prior) return errorBody('PROPOSAL_NOT_FOUND');
      clarifiesRunId = prior.id;
    }
    const claim = await claimRun(userId, {
      clientRequestId: req.clientRequestId,
      input: req.input ?? `[option ${req.replyTo?.optionId ?? ''}]`,
      modality: req.source === 'voice' ? 'VOICE' : 'TEXT',
      clarifiesRunId,
      requestId: meta.requestId,
      model: modelId(),
      promptVersion: PROMPT_VERSION,
    });
    if (claim.state === 'running') return errorBody('REQUEST_IN_PROGRESS', { runId: claim.run.id, retryAfterMs: 1000 });
    if (claim.state === 'finished') return replay(claim.run);
    run = claim.run;
  }

  const { state, focused } = await buildState(userId, run, req, deps, meta, now);
  let model: ModelRunResult | null = null;
  let response: CommandResponse;
  try {
    response = await runPipeline(state, req, focused, (m) => (model = m));
  } catch (e) {
    const executed = state.outcomes.some((o) => o.kind === 'executed');
    const isModel = !(e instanceof NotFoundError) && isModelFailure(e);
    logger.error('command.failed', { runId: run.id, err: e, model: isModel });
    // No partial writes: anything not yet executed is withdrawn.
    await expireRunProposals(userId, run.id);
    state.outcomes = state.outcomes.filter((o) => o.kind === 'executed');
    if (executed) {
      response = buildResponse(state, { modelText: '', stepLimitHit: true });
    } else {
      response = errorBody(isModel ? 'MODEL_ERROR' : 'INTERNAL', { runId: run.id });
    }
  }

  const m = metrics(state, model, startedAt, response);
  await finishRun(userId, run.id, {
    status: runStatusFor(response),
    result: response as unknown as Prisma.InputJsonValue,
    errorCode: response.kind === 'error' ? response.error.code : null,
    model: modelId(),
    finishedAt: deps.now(),
    ...m,
  });
  logger.info('command.completed', {
    runId: run.id,
    outcome: response.kind,
    intent: m.intent,
    latencyMs: m.latencyMs,
    steps: m.stepCount,
    // Key names avoid the logger's redaction of /token/ keys.
    usageIn: m.inputTokens,
    usageOut: m.outputTokens,
    ...(response.kind === 'error' ? { errorCode: response.error.code } : {}),
    taintForced: response.kind === 'proposal' && response.proposal.reasons.includes('untrusted_source'),
  });
  return response;
}

function isModelFailure(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as Error).name ?? '';
  return /^AI_/.test(name) || ['AbortError', 'TimeoutError', 'APICallError', 'RetryError'].includes(name) || 'isRetryable' in (e as object);
}

async function runPipeline(state: RunState, req: CommandRequest, focused: { handle: string; title: string } | null, onModel: (m: ModelRunResult) => void): Promise<CommandResponse> {
  // Clarification answer: resume without the model (§8.1).
  if (req.replyTo?.optionId) {
    const r = await resumeClarification(state, req.replyTo.runId, req.replyTo.optionId);
    if (!r.ok) return errorBody(r.code, { runId: state.runId });
    if (r.kind === 'resumed') {
      const res = buildResponse(state, { modelText: '' });
      if (r.lunchSaved && (res.kind === 'executed' || res.kind === 'proposal')) {
        res.message = `${res.message} I'll use ${r.lunchSaved} for "after lunch" from now on.`;
      }
      return res;
    }
    // A resolve-only clarification: re-run the original command with the pick pinned.
    state.input = r.input;
  }

  let priorContext: string | undefined;
  if (req.replyTo && !req.replyTo.optionId) {
    const open = await openClarification(state.userId, req.replyTo.runId);
    if (open) {
      const args = open.args as unknown as ClarificationArgs;
      priorContext = `the user asked "${args.originalInput}" and was asked "${args.question}"; this message is their reply.`;
    }
  }

  const model = await runModel(state, contextMessage(state, { focusedTask: focused, priorContext }));
  onModel(model);
  // An ambiguous reference the model never acted on still becomes a question, not a guess.
  if (!state.outcomes.some((o) => o.kind !== 'rejected')) await clarifyUnresolved(state);
  return buildResponse(state, { modelText: model.text, stepLimitHit: model.stepLimitHit && model.steps >= MAX_STEPS });
}

// ───────────────────────── confirm / cancel ─────────────────────────

export async function handleConfirm(userId: string, body: unknown, deps: CommandDeps, meta: CommandMeta = {}): Promise<CommandResponse> {
  const parsed = ConfirmRequest.safeParse(body);
  if (!parsed.success) return errorBody('INVALID_INPUT');
  const { proposalId, decision } = parsed.data;
  const proposal = await getProposal(userId, proposalId);
  if (!proposal || proposal.status === 'NEEDS_CLARIFICATION') return errorBody('PROPOSAL_NOT_FOUND');
  const runId = proposal.agentRunId;

  if (decision === 'cancel') {
    const r = await cancelProposal(userId, proposalId);
    if (!r.ok) return errorBody(r.code, { runId });
    logger.info('command.proposal_cancelled', { proposalId, runId });
    return { kind: 'answer', runId, message: 'Cancelled — nothing changed.' };
  }

  const run = await getRun(userId, runId);
  const source = run?.modality === 'VOICE' ? 'VOICE' : 'COMMAND';
  const r = await executeProposal(userId, proposalId, { deps, source, requestId: meta.requestId });
  logger.info('command.proposal_confirmed', { proposalId, runId, ok: r.ok, ...(r.ok ? { replayed: r.replayed } : { code: r.code }) });
  if (!r.ok) return errorBody(r.code, { runId, ...(r.message ? { message: r.message } : {}), needsReconnect: r.code === 'INTEGRATION_RECONNECT_REQUIRED' });
  return { kind: 'executed', runId, message: executedMessage([r.action]), actions: [r.action] };
}

// ───────────────────────── undo (§9.3) ─────────────────────────

/** Undo of an executed command action, by the taskEventId/batchId the response carried. */
export async function handleUndo(userId: string, body: unknown, deps: Pick<CommandDeps, 'now'>, meta: CommandMeta = {}): Promise<CommandResponse> {
  const parsed = UndoRequest.safeParse(body);
  if (!parsed.success) return errorBody('INVALID_INPUT');
  const { taskEventId, batchId } = parsed.data;
  const ctx = { source: 'COMMAND' as const, actorType: 'USER' as const, requestId: meta.requestId, now: deps.now() };
  try {
    const r = taskEventId ? await undoEvent(userId, taskEventId, ctx) : await undoBatch(userId, batchId!, ctx);
    const n = r.tasks.length;
    logger.info('command.undone', { batchId: r.batchId, tasks: n, replayed: r.replayed });
    return { kind: 'answer', runId: r.batchId, message: n === 1 ? `Undone: "${r.tasks[0].title}" is back as it was.` : `Undone ${n} changes.` };
  } catch (err) {
    if (err instanceof NotFoundError) return errorBody('NOT_FOUND');
    if (err instanceof ConflictError || err instanceof ValidationError) {
      return errorBody('CONFLICT', { message: "That can't be undone any more — it changed since, or it's too old." });
    }
    throw err;
  }
}

export { executedMessage };
