// lib/commands/execute.ts — executes a validated proposal (docs/04 §3 step
// 11, §11). The proposal id is the idempotency key:
//  - DB actions: one transaction claims the row (CAS PENDING → EXECUTING),
//    applies the change through the domain repo (which writes TaskEvents and
//    uses the proposal id as its operationId), marks the row EXECUTED and
//    writes an audit row. A concurrent confirm blocks on the row, then sees
//    EXECUTED and gets the stored result.
//  - Gmail drafts: the claim commits first, the draft is created with a
//    deterministic Message-ID (adopted on retry if it already exists), then
//    EXECUTED is committed (§11.3).
import { z } from 'zod';
import { recordAudit } from '@/lib/audit/audit-events';
import { type Tx, withTransaction } from '@/lib/db/tx';
import type { Prisma, ProposedAction, TaskSource } from '@/lib/generated/prisma/client';
import { listMemories, saveMemory } from '@/lib/memory/repo';
import { logger } from '@/lib/observability/logger';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  applyBulkUpdate,
  completeTask,
  createReminder,
  createTask,
  getTask,
  listTasks,
  reopenTask,
  snoozeTask,
  softDeleteTask,
  updateTask,
  type MutationContext,
} from '@/lib/tasks/repo';
import { normalizeForSimilarity } from '@/lib/tasks/validation';
import type { CommandDeps } from './deps';
import { isReconnect, toolErrorFor } from './errors';
import { getProposal, transitionProposal, updateProposal } from './repo';
import { KIND_TOOL, type ProposalKind } from './risk';
import type { ErrorCode, ExecutedAction } from './types';

// ───────────────────────── executor schemas (step 9 re-validation) ─────────────────────────

const Iso = z.string().datetime();
const Id = z.string().min(1).max(64);
const Version = z.number().int().min(1);

const TaskPatch = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    dueAt: Iso.nullable().optional(),
    dueHasTime: z.boolean().optional(),
    startAt: Iso.nullable().optional(),
    projectId: Id.nullable().optional(),
    tags: z.array(z.string().max(30)).max(20).optional(),
    estimateMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    recurrenceRule: z.string().max(200).nullable().optional(),
  })
  .strict();

export const EXECUTOR_SCHEMAS = {
  'task.create': TaskPatch.extend({ title: z.string().trim().min(1).max(200), timeZone: z.string().max(64).optional() }).strict(),
  'task.update': z.object({ taskId: Id, expectedVersion: Version, patch: TaskPatch }).strict(),
  'task.complete': z.object({ taskId: Id, expectedVersion: Version }).strict(),
  'task.reopen': z.object({ taskId: Id, expectedVersion: Version }).strict(),
  'task.delete': z.object({ taskId: Id, expectedVersion: Version }).strict(),
  'task.snooze': z.object({ taskId: Id, expectedVersion: Version, until: Iso }).strict(),
  'task.bulk': z
    .object({
      expected: z.array(z.object({ id: Id, version: Version })).min(1).max(50),
      change: z
        .object({
          dueAt: Iso.nullable().optional(),
          dueHasTime: z.boolean().optional(),
          complete: z.literal(true).optional(),
          priority: z.number().int().min(0).max(4).optional(),
          addTags: z.array(z.string().max(30)).max(10).optional(),
        })
        .strict(),
    })
    .strict(),
  'reminder.create': z.object({ taskId: Id.optional(), title: z.string().trim().min(1).max(200).optional(), remindAt: Iso }).strict(),
  'memory.save': z.object({ content: z.string().trim().min(1).max(1000) }).strict(),
  'email.draft': z
    .object({
      to: z.array(z.string().email()).min(1).max(10),
      subject: z.string().max(200),
      body: z.string().min(1).max(5000),
      inReplyToMessageId: z.string().max(128).optional(),
      threadId: z.string().max(128).optional(),
      messageIdHeader: z.string().max(200),
    })
    .strict(),
} satisfies Record<ProposalKind, z.ZodType>;

export type ExecutorArgs<K extends ProposalKind> = z.infer<(typeof EXECUTOR_SCHEMAS)[K]>;

export type ExecuteResult =
  | { ok: true; action: ExecutedAction; replayed: boolean }
  | { ok: false; code: ErrorCode; message?: string };

export interface ExecuteOptions {
  deps: CommandDeps;
  source: Extract<TaskSource, 'COMMAND' | 'VOICE'>;
  requestId?: string;
}

class NotClaimed extends Error {}

const date = (iso: string | null | undefined) => (iso === undefined ? undefined : iso === null ? null : new Date(iso));

function toPatch(p: z.infer<typeof TaskPatch>) {
  return {
    ...(p.title !== undefined ? { title: p.title } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.priority !== undefined ? { priority: p.priority } : {}),
    ...(p.dueAt !== undefined ? { dueAt: date(p.dueAt), dueHasTime: p.dueHasTime ?? false } : {}),
    ...(p.startAt !== undefined ? { startAt: date(p.startAt) } : {}),
    ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
    ...(p.tags !== undefined ? { tags: p.tags } : {}),
    ...(p.estimateMinutes !== undefined ? { estimateMinutes: p.estimateMinutes } : {}),
    ...(p.recurrenceRule !== undefined ? { recurrenceRule: p.recurrenceRule } : {}),
  };
}

interface Applied {
  entity: ExecutedAction['entity'];
  undo?: ExecutedAction['undo'];
  extra?: Record<string, unknown>;
}

async function applyDbAction(tx: Tx, p: ProposedAction, kind: ProposalKind, args: unknown, mctx: MutationContext, embedding: number[] | null): Promise<Applied> {
  const userId = p.userId;
  const undo = (eventIds: string[], batchId?: string) => (eventIds[0] ? { undo: { taskEventId: eventIds[0], ...(batchId ? { batchId } : {}) } } : {});
  switch (kind) {
    case 'task.create': {
      const a = args as ExecutorArgs<'task.create'>;
      const dueAt = date(a.dueAt) ?? null;
      // Content dedupe (§5.2): same normalised title + due created in the last 60 s.
      const recent = await listTasks(userId, { kind: 'all' }, { filter: { createdFrom: new Date(mctx.now!.getTime() - 60_000) }, limit: 50, tx });
      const dupe = recent.items
        .map((i) => i.task)
        .find((t) => normalizeForSimilarity(t.title) === normalizeForSimilarity(a.title) && (t.dueAt?.getTime() ?? null) === (dueAt?.getTime() ?? null));
      if (dupe) return { entity: { type: 'task', id: dupe.id }, extra: { deduped: true } };
      const r = await createTask(userId, { ...toPatch(a), title: a.title, timeZone: a.timeZone ?? null, dueAt, dueHasTime: a.dueHasTime ?? false }, { ...mctx, detectDuplicates: false });
      return { entity: { type: 'task', id: r.task.id }, ...undo(r.eventIds) };
    }
    case 'task.update': {
      const a = args as ExecutorArgs<'task.update'>;
      const r = await updateTask(userId, a.taskId, a.expectedVersion, toPatch(a.patch), mctx);
      return { entity: { type: 'task', id: r.task.id }, ...undo(r.eventIds) };
    }
    case 'task.complete': {
      const a = args as ExecutorArgs<'task.complete'>;
      const current = await getTask(userId, a.taskId, { tx });
      if (current.status === 'DONE') return { entity: { type: 'task', id: current.id }, extra: { alreadyInState: true } };
      const r = await completeTask(userId, a.taskId, { ...mctx, expectedVersion: a.expectedVersion });
      return { entity: { type: 'task', id: r.task.id }, ...undo(r.eventIds) };
    }
    case 'task.reopen': {
      const a = args as ExecutorArgs<'task.reopen'>;
      const current = await getTask(userId, a.taskId, { tx });
      if (current.status !== 'DONE' && current.status !== 'CANCELLED') return { entity: { type: 'task', id: current.id }, extra: { alreadyInState: true } };
      const r = await reopenTask(userId, a.taskId, { ...mctx, expectedVersion: a.expectedVersion });
      return { entity: { type: 'task', id: r.task.id }, ...undo(r.eventIds) };
    }
    case 'task.delete': {
      const a = args as ExecutorArgs<'task.delete'>;
      const r = await softDeleteTask(userId, a.taskId, { ...mctx, expectedVersion: a.expectedVersion });
      return { entity: { type: 'task', id: r.task.id }, ...undo(r.eventIds) };
    }
    case 'task.snooze': {
      const a = args as ExecutorArgs<'task.snooze'>;
      const r = await snoozeTask(userId, a.taskId, new Date(a.until), { ...mctx, expectedVersion: a.expectedVersion });
      return { entity: { type: 'task', id: r.task.id }, ...undo(r.eventIds) };
    }
    case 'task.bulk': {
      const a = args as ExecutorArgs<'task.bulk'>;
      const change = {
        ...(a.change.dueAt !== undefined ? { dueAt: date(a.change.dueAt), dueHasTime: a.change.dueHasTime ?? false } : {}),
        ...(a.change.complete ? { complete: true as const } : {}),
        ...(a.change.priority !== undefined ? { priority: a.change.priority } : {}),
        ...(a.change.addTags ? { addTags: a.change.addTags } : {}),
      };
      const r = await applyBulkUpdate(userId, { ids: a.expected.map((e) => e.id) }, change, { ...mctx, expected: a.expected, max: 50 });
      return { entity: { type: 'task', id: r.tasks[0]?.id ?? '' }, ...undo(r.eventIds, r.batchId), extra: { count: r.tasks.length } };
    }
    case 'reminder.create': {
      const a = args as ExecutorArgs<'reminder.create'>;
      const r = await createReminder(userId, { taskId: a.taskId ?? null, title: a.title, remindAt: new Date(a.remindAt) }, mctx);
      return { entity: { type: 'reminder', id: r.reminder.id }, ...undo(r.eventIds) };
    }
    case 'memory.save': {
      const a = args as ExecutorArgs<'memory.save'>;
      const existing = await listMemories(userId, { text: a.content, limit: 20, tx });
      const same = existing.items.find((m) => m.content === a.content.trim());
      if (same) return { entity: { type: 'memory', id: same.id }, extra: { deduped: true } };
      const m = await saveMemory(userId, a.content, {
        tx,
        actorType: 'AGENT',
        agentRunId: p.agentRunId,
        proposedActionId: p.id,
        source: 'COMMAND',
        embed: embedding ? async () => embedding : undefined,
      });
      return { entity: { type: 'memory', id: m.id } };
    }
    case 'email.draft':
      throw new Error('email.draft is not a DB action');
  }
}

function storedAction(p: ProposedAction): ExecutedAction | null {
  const r = p.result as { action?: ExecutedAction } | null;
  return r?.action ?? null;
}

/** Why a proposal could not be claimed, as a response. */
async function inspect(userId: string, id: string, now: Date): Promise<ExecuteResult> {
  const p = await getProposal(userId, id);
  if (!p || p.status === 'NEEDS_CLARIFICATION') return { ok: false, code: 'PROPOSAL_NOT_FOUND' };
  switch (p.status) {
    case 'EXECUTED': {
      const action = storedAction(p);
      return action ? { ok: true, action, replayed: true } : { ok: false, code: 'INTERNAL' };
    }
    case 'EXECUTING':
      return { ok: false, code: 'REQUEST_IN_PROGRESS' };
    case 'FAILED':
      return { ok: false, code: p.errorCode === 'CONFLICT' ? 'CONFLICT' : 'PROPOSAL_EXPIRED' };
    case 'PENDING':
      if (p.expiresAt <= now) {
        await transitionProposal(userId, id, 'PENDING', 'EXPIRED');
        return { ok: false, code: 'PROPOSAL_EXPIRED' };
      }
      return { ok: false, code: 'REQUEST_IN_PROGRESS' };
    default:
      return { ok: false, code: 'PROPOSAL_EXPIRED' };
  }
}

function action(p: ProposedAction, applied: Applied): ExecutedAction {
  return {
    proposalId: p.id,
    tool: KIND_TOOL[p.kind as ProposalKind] ?? p.kind,
    entity: applied.entity,
    summary: p.summary,
    ...(applied.undo ? { undo: applied.undo } : {}),
  };
}

export async function executeProposal(userId: string, proposalId: string, opts: ExecuteOptions): Promise<ExecuteResult> {
  const now = opts.deps.now();
  const p = await getProposal(userId, proposalId);
  if (!p) return { ok: false, code: 'PROPOSAL_NOT_FOUND' };
  const kind = p.kind as ProposalKind;
  const schema = EXECUTOR_SCHEMAS[kind];
  if (!schema) return { ok: false, code: 'POLICY_REJECTED' };
  if (p.status !== 'PENDING') return inspect(userId, proposalId, now);

  const parsed = schema.safeParse(p.args);
  if (!parsed.success) {
    await transitionProposal(userId, proposalId, 'PENDING', 'FAILED', { errorCode: 'INVALID_ARGS' });
    return { ok: false, code: 'POLICY_REJECTED', message: 'That suggestion is no longer valid — ask again.' };
  }
  if (kind === 'email.draft') return executeDraft(p, parsed.data as ExecutorArgs<'email.draft'>, opts, now);

  // Provider latency must not hold a DB transaction: embed first.
  let embedding: number[] | null = null;
  if (kind === 'memory.save') {
    try {
      embedding = await opts.deps.embed((parsed.data as ExecutorArgs<'memory.save'>).content);
    } catch {
      embedding = null; // saved as pending; a backfill job embeds it later
    }
  }

  try {
    return await withTransaction(async (tx) => {
      const claimed = await transitionProposal(userId, proposalId, 'PENDING', 'EXECUTING', { confirmedAt: p.requiresConfirmation ? now : undefined }, { tx, notExpiredAt: now });
      if (!claimed) throw new NotClaimed();
      const mctx: MutationContext = {
        tx,
        source: opts.source,
        actorType: 'AGENT',
        operationId: `proposal:${p.id}`,
        agentRunId: p.agentRunId,
        proposedActionId: p.id,
        requestId: opts.requestId,
        now,
      };
      const applied = await applyDbAction(tx, p, kind, parsed.data, mctx, embedding);
      const executed = action(p, applied);
      await updateProposal(userId, p.id, { status: 'EXECUTED', executedAt: now, result: { action: executed, ...applied.extra } as unknown as Prisma.InputJsonValue }, { tx });
      await recordAudit(tx, {
        userId,
        actorType: 'AGENT',
        action: 'command.execute',
        entityType: applied.entity.type,
        entityId: applied.entity.id,
        agentRunId: p.agentRunId,
        proposalId: p.id,
        requestId: opts.requestId,
        metadata: { kind, risk: p.risk, confirmed: p.requiresConfirmation },
      });
      return { ok: true as const, action: executed, replayed: false };
    });
  } catch (e) {
    if (e instanceof NotClaimed) return inspect(userId, proposalId, now);
    if (e instanceof ConflictError || e instanceof NotFoundError) {
      await transitionProposal(userId, proposalId, 'PENDING', 'FAILED', { errorCode: 'CONFLICT' });
      return { ok: false, code: 'CONFLICT' };
    }
    if (e instanceof ValidationError) {
      await transitionProposal(userId, proposalId, 'PENDING', 'FAILED', { errorCode: e.reason });
      return { ok: false, code: 'POLICY_REJECTED', message: e.reason === 'BULK_LIMIT' ? 'I can change at most 50 tasks at once.' : e.message };
    }
    logger.error('command.execute_failed', { proposalId, kind, errorName: (e as Error)?.name });
    throw e;
  }
}

async function executeDraft(p: ProposedAction, args: ExecutorArgs<'email.draft'>, opts: ExecuteOptions, now: Date): Promise<ExecuteResult> {
  const userId = p.userId;
  const claimed = await transitionProposal(userId, p.id, 'PENDING', 'EXECUTING', { confirmedAt: now }, { notExpiredAt: now });
  if (!claimed) return inspect(userId, p.id, now);

  let draftId: string;
  try {
    const gmail = await opts.deps.google(userId).gmail();
    const existing = gmail.findDraftByMessageId ? await gmail.findDraftByMessageId(args.messageIdHeader) : null;
    const created =
      existing ??
      (await gmail.createDraft({
        to: args.to,
        subject: args.subject,
        body: args.body,
        messageIdHeader: args.messageIdHeader,
        ...(args.inReplyToMessageId ? { inReplyToMessageId: args.inReplyToMessageId } : {}),
        ...(args.threadId ? { threadId: args.threadId } : {}),
      }));
    draftId = created.draftId;
  } catch (e) {
    // Release the claim so the user can retry; a retry adopts a draft that
    // was in fact created via the Message-ID lookup.
    await transitionProposal(userId, p.id, 'EXECUTING', 'PENDING');
    const code = isReconnect(e) ? 'INTEGRATION_RECONNECT_REQUIRED' : toolErrorFor(e) === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE';
    logger.warn('command.draft_failed', { proposalId: p.id, errorName: (e as Error)?.name, code });
    return { ok: false, code, ...(code === 'PROVIDER_UNAVAILABLE' ? { message: "Gmail isn't responding right now." } : {}) };
  }

  const executed = action(p, { entity: { type: 'email_draft', id: draftId } });
  await withTransaction(async (tx) => {
    await updateProposal(userId, p.id, { status: 'EXECUTED', executedAt: now, result: { action: executed } as unknown as Prisma.InputJsonValue }, { tx });
    await recordAudit(tx, {
      userId,
      actorType: 'AGENT',
      action: 'command.execute',
      entityType: 'email_draft',
      entityId: draftId,
      agentRunId: p.agentRunId,
      proposalId: p.id,
      requestId: opts.requestId,
      metadata: { kind: 'email.draft', recipients: args.to.length, bodyLength: args.body.length },
    });
  });
  return { ok: true, action: executed, replayed: false };
}

/** User pressed Cancel: PENDING → CANCELLED. */
export async function cancelProposal(userId: string, proposalId: string): Promise<{ ok: true } | { ok: false; code: ErrorCode }> {
  const p = await getProposal(userId, proposalId);
  if (!p || p.status === 'NEEDS_CLARIFICATION') return { ok: false, code: 'PROPOSAL_NOT_FOUND' };
  if (p.status === 'CANCELLED') return { ok: true };
  if (await transitionProposal(userId, proposalId, 'PENDING', 'CANCELLED')) return { ok: true };
  const current = await getProposal(userId, proposalId);
  if (current?.status === 'EXECUTED' || current?.status === 'EXECUTING') return { ok: false, code: 'REQUEST_IN_PROGRESS' };
  return { ok: false, code: 'PROPOSAL_EXPIRED' };
}
