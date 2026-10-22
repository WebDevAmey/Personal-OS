// lib/tasks/repo/history.ts — append-only task history, undo (FR-262/263)
// and retention purge. TaskEvent rows are only ever inserted and read here.
import { ConflictError, NotFoundError, ValidationError } from '@/lib/db/errors';
import { type Tx, isUniqueViolation, reader, withTransaction } from '@/lib/db/tx';
import type { Prisma, TaskEvent } from '@/lib/generated/prisma/client';
import { recordAudit } from '@/lib/audit/audit-events';
import type { MutationContext, Task } from '../types';
import { OPEN_STATUSES } from '../types';
import { snapshotToData } from '../validation';
import { doRestore, doSoftDelete } from './core';
import { type RunCtx, casUpdate, loadOwnedTask, runMutation, writeEvent } from './internal';
import { doAddDependency } from './relations';

/** Default undo window (product toast + command "undo"). */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export interface HistoryPage {
  events: TaskEvent[];
  nextCursor: string | null;
}

function page(events: TaskEvent[], limit: number): HistoryPage {
  const more = events.length > limit;
  const slice = more ? events.slice(0, limit) : events;
  const last = slice[slice.length - 1];
  return {
    events: slice,
    nextCursor: more && last ? Buffer.from(JSON.stringify({ t: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null,
  };
}

function cursorWhere(cursor: string | null | undefined): Prisma.TaskEventWhereInput {
  if (!cursor) return {};
  let c: { t: string; id: string };
  try {
    c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('INVALID_CURSOR', 'Invalid pagination cursor', 'cursor');
  }
  const t = new Date(c.t);
  return { OR: [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: c.id } }] };
}

/** A task's timeline, newest first (includes deleted tasks for the trash view). */
export async function listTaskHistory(userId: string, taskId: string, opts: { cursor?: string | null; limit?: number; tx?: Tx } = {}): Promise<HistoryPage> {
  const tx = reader(opts.tx);
  await loadOwnedTask(tx, userId, taskId, { includeDeleted: true });
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const events = await tx.taskEvent.findMany({
    where: { AND: [{ userId, taskId }, cursorWhere(opts.cursor)] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  return page(events, limit);
}

/** All of a user's task events, newest first (activity feed / undo stack). */
export async function listActivity(userId: string, opts: { cursor?: string | null; limit?: number; tx?: Tx } = {}): Promise<HistoryPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const events = await reader(opts.tx).taskEvent.findMany({
    where: { AND: [{ userId }, cursorWhere(opts.cursor)] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  return page(events, limit);
}

// ───────────────────────── undo ─────────────────────────

export interface UndoResult {
  /** UNDONE event ids written. */
  eventIds: string[];
  tasks: Task[];
  batchId: string;
  replayed: boolean;
}

const ROW_EVENTS = new Set(['CREATED', 'UPDATED', 'STATUS_CHANGED', 'COMPLETED', 'REOPENED', 'SNOOZED', 'MOVED', 'ARCHIVED', 'UNARCHIVED', 'DELETED', 'RESTORED']);

async function undone(tx: Tx, run: RunCtx, ev: TaskEvent, task: Task, extra: Record<string, unknown> = {}): Promise<string> {
  return writeEvent(tx, run, {
    userId: ev.userId,
    taskId: ev.taskId,
    type: 'UNDONE',
    taskVersion: task.version,
    before: (ev.after as Record<string, unknown> | null) ?? null,
    after: { ...((ev.before as Record<string, unknown> | null) ?? {}), ...extra },
    revertsEventId: ev.id,
  });
}

/** Retires the occurrence a completion/cancel/delete rolled, if nobody touched it. */
async function unrollOccurrence(tx: Tx, userId: string, nextId: unknown, run: RunCtx): Promise<string[]> {
  if (typeof nextId !== 'string') return [];
  const next = await tx.task.findFirst({ where: { id: nextId, userId } });
  if (!next || next.deletedAt) return [];
  if (next.version !== 1 || !(OPEN_STATUSES as readonly string[]).includes(next.status)) {
    throw new ConflictError('Task', 'CHANGED_SINCE', { id: nextId });
  }
  const r = await doSoftDelete(tx, userId, next, run, 'series');
  return r.eventIds;
}

async function undoOne(
  tx: Tx,
  userId: string,
  ev: TaskEvent,
  run: RunCtx,
  windowMs: number,
  expectedVersion: number = ev.taskVersion,
): Promise<{ eventIds: string[]; task: Task }> {
  if (ev.type === 'UNDONE' || ev.type === 'IMPORTED' || ev.type === 'RECURRENCE_ROLLED') {
    throw new ValidationError('NOT_UNDOABLE', `A ${ev.type} event cannot be undone`, 'eventId');
  }
  if (run.now.getTime() - ev.createdAt.getTime() > windowMs) throw new ValidationError('UNDO_EXPIRED', 'This change is too old to undo', 'eventId');
  if (await tx.taskEvent.findUnique({ where: { revertsEventId: ev.id }, select: { id: true } })) {
    throw new ConflictError('TaskEvent', 'ALREADY_UNDONE', { id: ev.id });
  }
  const task = await loadOwnedTask(tx, userId, ev.taskId, { includeDeleted: true });
  if (ROW_EVENTS.has(ev.type) && task.version !== expectedVersion) {
    throw new ConflictError('Task', 'CHANGED_SINCE', { id: task.id, currentVersion: task.version, expectedVersion });
  }
  const before = (ev.before as Record<string, unknown> | null) ?? {};
  const after = (ev.after as Record<string, unknown> | null) ?? {};
  const eventIds: string[] = [];

  switch (ev.type) {
    case 'CREATED': {
      const r = await doSoftDelete(tx, userId, task, run, 'series');
      // doSoftDelete wrote its own DELETED event; the UNDONE marker links the revert.
      eventIds.push(await undone(tx, run, ev, r.task, { deletedAt: r.task.deletedAt?.toISOString() }), ...r.eventIds);
      return { eventIds, task: r.task };
    }
    case 'DELETED': {
      const r = await doRestore(tx, userId, task, run, { details: after, eventType: 'UNDONE', revertsEventId: ev.id });
      return { eventIds: r.eventIds, task: r.task };
    }
    case 'COMPLETED':
    case 'STATUS_CHANGED':
    case 'REOPENED': {
      // Free the series' open slot before reopening this occurrence.
      eventIds.push(...(await unrollOccurrence(tx, userId, after.nextOccurrenceId, run)));
      const updated = await casUpdate(tx, userId, task, snapshotToData(before) as Prisma.TaskUpdateManyMutationInput);
      if (typeof after.supersededOccurrenceId === 'string') {
        const sup = await tx.task.findFirst({ where: { id: after.supersededOccurrenceId, userId, deletedAt: { not: null } } });
        if (sup) eventIds.push(...(await doRestore(tx, userId, sup, run)).eventIds);
      }
      eventIds.unshift(await undone(tx, run, ev, updated));
      return { eventIds, task: updated };
    }
    case 'UPDATED':
    case 'MOVED':
    case 'SNOOZED':
    case 'ARCHIVED':
    case 'UNARCHIVED': {
      const updated = await casUpdate(tx, userId, task, snapshotToData(before) as Prisma.TaskUpdateManyMutationInput);
      return { eventIds: [await undone(tx, run, ev, updated)], task: updated };
    }
    case 'RESTORED': {
      const r = await doSoftDelete(tx, userId, task, run, 'series');
      return { eventIds: [await undone(tx, run, ev, r.task), ...r.eventIds], task: r.task };
    }
    case 'DEPENDENCY_ADDED': {
      if (typeof after.dependsOnId === 'string') {
        await tx.taskDependency.deleteMany({ where: { taskId: task.id, dependsOnId: after.dependsOnId, userId } });
      }
      return { eventIds: [await undone(tx, run, ev, task)], task };
    }
    case 'DEPENDENCY_REMOVED': {
      if (typeof before.dependsOnId === 'string') {
        const r = await doAddDependency(tx, userId, task.id, before.dependsOnId, run);
        eventIds.push(...r.eventIds);
      }
      return { eventIds: [await undone(tx, run, ev, task), ...eventIds], task };
    }
    case 'REMINDER_SET': {
      const reminderId = after.reminderId as string | undefined;
      if (reminderId) {
        if (typeof after.previousRemindAt === 'string') {
          await tx.reminder.updateMany({
            where: { id: reminderId, userId, status: 'PENDING' },
            data: { remindAt: new Date(after.previousRemindAt), version: { increment: 1 } },
          });
        } else {
          await tx.reminder.updateMany({ where: { id: reminderId, userId }, data: { status: 'CANCELLED', version: { increment: 1 } } });
        }
      }
      return { eventIds: [await undone(tx, run, ev, task)], task };
    }
    case 'REMINDER_CLEARED': {
      const reminderId = after.reminderId as string | undefined;
      if (reminderId) {
        await tx.reminder.updateMany({
          where: { id: reminderId, userId, status: 'CANCELLED', remindAt: { gt: run.now } },
          data: { status: 'PENDING', version: { increment: 1 } },
        });
      }
      return { eventIds: [await undone(tx, run, ev, task)], task };
    }
    default:
      throw new ValidationError('NOT_UNDOABLE', `A ${ev.type} event cannot be undone`, 'eventId');
  }
}

const undoCodec = (userId: string) => ({
  store: (r: UndoResult) => ({ eventIds: r.eventIds, taskIds: r.tasks.map((t) => t.id), batchId: r.batchId }) as Prisma.InputJsonValue,
  replay: async (tx: Tx, s: Record<string, unknown>) => ({
    eventIds: s.eventIds as string[],
    batchId: s.batchId as string,
    tasks: await tx.task.findMany({ where: { id: { in: s.taskIds as string[] }, userId } }),
    replayed: true,
  }),
});

async function guardDoubleUndo<T>(fn: () => Promise<T>, eventId: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e, 'revertsEventId')) throw new ConflictError('TaskEvent', 'ALREADY_UNDONE', { id: eventId });
    throw e;
  }
}

/**
 * Reverts one TaskEvent (the undo token returned by every mutation), within
 * `windowMs` (default 10 min) and only if no later change touched the task.
 * Writes an UNDONE event pointing at the original.
 */
export function undoEvent(userId: string, eventId: string, ctx: MutationContext & { windowMs?: number } = {}): Promise<UndoResult> {
  return guardDoubleUndo(
    () =>
      runMutation(
        userId,
        ctx,
        'task.undo',
        async (tx, run) => {
          const ev = await tx.taskEvent.findFirst({ where: { id: eventId, userId } });
          if (!ev) throw new NotFoundError('TaskEvent', eventId);
          const r = await undoOne(tx, userId, ev, run, ctx.windowMs ?? UNDO_WINDOW_MS);
          return { eventIds: r.eventIds, tasks: [r.task], batchId: run.batchId, replayed: false };
        },
        undoCodec(userId),
      ),
    eventId,
  );
}

/** Reverts every primary event of a bulk apply (same batchId), all or nothing. */
export function undoBatch(userId: string, batchId: string, ctx: MutationContext & { windowMs?: number } = {}): Promise<UndoResult> {
  return guardDoubleUndo(
    () =>
      runMutation(
        userId,
        ctx,
        'task.undo_batch',
        async (tx, run) => {
          const events = await tx.taskEvent.findMany({
            where: { userId, batchId, type: { notIn: ['UNDONE', 'RECURRENCE_ROLLED', 'IMPORTED'] } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (events.length === 0) throw new NotFoundError('TaskEvent batch', batchId);
          const eventIds: string[] = [];
          const tasks = new Map<string, Task>();
          // Side-effect events (a dependency edge removed by a delete, a
          // subtask deleted with its parent) are reverted by their primary event.
          const primary = events.filter((e) => {
            const a = (e.after as Record<string, unknown> | null) ?? {};
            return !a.deletedWithParent && a.reason !== 'DEPENDENCY_DELETED' && !a.reason;
          });
          // Newest first. A task touched twice in the batch (e.g. moved, then
          // completed) is checked against the version our own revert produced.
          const versionAfterRevert = new Map<string, number>();
          for (const ev of primary) {
            const r = await undoOne(tx, userId, ev, run, ctx.windowMs ?? UNDO_WINDOW_MS, versionAfterRevert.get(ev.taskId) ?? ev.taskVersion);
            versionAfterRevert.set(r.task.id, r.task.version);
            eventIds.push(...r.eventIds);
            tasks.set(r.task.id, r.task);
          }
          return { eventIds, tasks: [...tasks.values()], batchId: run.batchId, replayed: false };
        },
        undoCodec(userId),
      ),
    batchId,
  );
}

// ───────────────────────── retention (system job) ─────────────────────────

/**
 * Hard-deletes tasks soft-deleted before `olderThan` (default 30 days), in
 * batches; events, dependencies and reminders cascade. Writes one
 * AuditEvent "task.purge" per task (id only).
 */
export async function purgeDeletedTasks(opts: { olderThan?: Date; batchSize?: number; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = opts.olderThan ?? new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const rows = await reader().task.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, userId: true },
    take: Math.min(opts.batchSize ?? 1000, 1000),
    orderBy: { id: 'asc' },
  });
  if (rows.length === 0) return 0;
  await withTransaction(async (tx) => {
    await tx.task.deleteMany({ where: { id: { in: rows.map((r) => r.id) }, deletedAt: { lt: cutoff } } });
    for (const r of rows) {
      await recordAudit(tx, { userId: r.userId, actorType: 'SYSTEM', action: 'task.purge', entityType: 'Task', entityId: r.id });
    }
  });
  return rows.length;
}
