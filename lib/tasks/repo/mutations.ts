// lib/tasks/repo/mutations.ts — public single-task mutations (ADR-006).
// Every function: userId first, writes TaskEvent(s) in the same transaction,
// accepts MutationContext (source, operationId, tx, …).
import { type Tx, reader } from '@/lib/db/tx';
import type {
  CompleteTaskResult,
  CreateTaskInput,
  CreateTaskResult,
  MutationContext,
  Task,
  TaskMutationResult,
  UpdateTaskPatch,
} from '../types';
import {
  type RecurrenceScope,
  doArchive,
  doCancel,
  doComplete,
  doCreate,
  doReopen,
  doRestore,
  doSnooze,
  doSoftDelete,
  doUpdate,
  latestDeletion,
} from './core';
import { assertVersion, loadOwnedTask, retryOnVersionConflict, runMutation, storedTaskResult } from './internal';
import { findSimilarTasks } from './search';

interface Stored {
  taskId: string;
  eventIds: string[];
  batchId: string;
  [k: string]: unknown;
}

async function replayTask(tx: Tx, userId: string, stored: Record<string, unknown>): Promise<TaskMutationResult> {
  const s = stored as Stored;
  const task = await loadOwnedTask(tx, userId, s.taskId, { includeDeleted: true });
  return { task, eventIds: s.eventIds, batchId: s.batchId, replayed: true };
}

function simpleCodec(userId: string) {
  return {
    store: (r: TaskMutationResult) => storedTaskResult(r),
    replay: (tx: Tx, stored: Record<string, unknown>) => replayTask(tx, userId, stored),
  };
}

export async function createTask(userId: string, input: CreateTaskInput, ctx: MutationContext & { detectDuplicates?: boolean } = {}): Promise<CreateTaskResult> {
  const result = await runMutation(
    userId,
    ctx,
    'task.create',
    async (tx, run) => {
      const r = await doCreate(tx, userId, input, run);
      return { ...r, batchId: run.batchId, replayed: false };
    },
    simpleCodec(userId),
  );
  const similar =
    ctx.detectDuplicates === false || result.replayed
      ? []
      : await findSimilarTasks(userId, result.task.title, { excludeId: result.task.id, tx: ctx.tx });
  return { ...result, similar };
}

export async function getTask(userId: string, taskId: string, opts: { includeDeleted?: boolean; tx?: Tx } = {}): Promise<Task> {
  return loadOwnedTask(reader(opts.tx), userId, taskId, opts);
}

/** Field update with optimistic concurrency: `expectedVersion` must equal the stored version. */
export async function updateTask(
  userId: string,
  taskId: string,
  expectedVersion: number,
  patch: UpdateTaskPatch,
  ctx: MutationContext = {},
): Promise<TaskMutationResult> {
  return runMutation(
    userId,
    ctx,
    'task.update',
    async (tx, run) => {
      const task = await loadOwnedTask(tx, userId, taskId);
      assertVersion(task, expectedVersion);
      const r = await doUpdate(tx, userId, task, patch, run);
      return { ...r, batchId: run.batchId, replayed: false };
    },
    simpleCodec(userId),
  );
}

/**
 * Completes a task. Idempotent: completing a DONE task (or losing a race to a
 * concurrent completion) writes nothing and reports alreadyCompleted. For a
 * recurring task exactly one next occurrence is generated.
 */
export async function completeTask(
  userId: string,
  taskId: string,
  ctx: MutationContext & { expectedVersion?: number; completeSubtasks?: boolean } = {},
): Promise<CompleteTaskResult> {
  return runMutation<CompleteTaskResult>(
    userId,
    ctx,
    'task.complete',
    (tx, run) =>
      retryOnVersionConflict(async () => {
        const task = await loadOwnedTask(tx, userId, taskId);
        if (task.status !== 'DONE') assertVersion(task, ctx.expectedVersion);
        const r = await doComplete(tx, userId, task, run, { completeSubtasks: ctx.completeSubtasks });
        return { ...r, batchId: run.batchId, replayed: false };
      }, ctx.expectedVersion === undefined ? 3 : 1),
    {
      store: (r) => storedTaskResult(r, { alreadyCompleted: r.alreadyCompleted, nextOccurrenceId: r.nextOccurrence?.id ?? null, warnings: r.warnings }),
      replay: async (tx, stored) => {
        const base = await replayTask(tx, userId, stored);
        const nextId = stored.nextOccurrenceId as string | null;
        const nextOccurrence = nextId ? await loadOwnedTask(tx, userId, nextId, { includeDeleted: true }) : null;
        return { ...base, alreadyCompleted: Boolean(stored.alreadyCompleted), nextOccurrence, warnings: (stored.warnings as CompleteTaskResult['warnings']) ?? [] };
      },
    },
  );
}

function versionedAction(
  kind: string,
  action: (tx: Tx, userId: string, task: Task, run: Parameters<typeof doReopen>[3]) => Promise<{ task: Task; eventIds: string[] }>,
  opts: { includeDeleted?: boolean } = {},
) {
  return (userId: string, taskId: string, ctx: MutationContext & { expectedVersion?: number } = {}): Promise<TaskMutationResult> =>
    runMutation(
      userId,
      ctx,
      kind,
      (tx, run) =>
        retryOnVersionConflict(async () => {
          const task = await loadOwnedTask(tx, userId, taskId, opts);
          assertVersion(task, ctx.expectedVersion);
          const r = await action(tx, userId, task, run);
          return { ...r, batchId: run.batchId, replayed: false };
        }, ctx.expectedVersion === undefined ? 3 : 1),
      simpleCodec(userId),
    );
}

/** DONE/CANCELLED → TODO. Retires an untouched rolled occurrence of the series. */
export const reopenTask = versionedAction('task.reopen', doReopen);

export const archiveTask = versionedAction('task.archive', (tx, u, t, run) => doArchive(tx, u, t, run, true));
export const unarchiveTask = versionedAction('task.unarchive', (tx, u, t, run) => doArchive(tx, u, t, run, false));

/** Restores a soft-deleted task with the reminders, edges and subtasks its deletion removed. */
export const restoreTask = versionedAction(
  'task.restore',
  async (tx, u, t, run) => doRestore(tx, u, t, run, { details: await latestDeletion(tx, u, t.id) }),
  { includeDeleted: true },
);

/** Cancels a task; for a recurring task scope 'occurrence' skips to the next one. */
export function cancelTask(userId: string, taskId: string, ctx: MutationContext & { expectedVersion?: number; scope?: RecurrenceScope } = {}) {
  return versionedAction('task.cancel', (tx, u, t, run) => doCancel(tx, u, t, run, ctx.scope))(userId, taskId, ctx);
}

/** Soft delete (undoable, purged after 30 days); scope 'occurrence' rolls a recurring task forward. */
export function softDeleteTask(userId: string, taskId: string, ctx: MutationContext & { expectedVersion?: number; scope?: RecurrenceScope } = {}) {
  return versionedAction('task.delete', (tx, u, t, run) => doSoftDelete(tx, u, t, run, ctx.scope))(userId, taskId, ctx);
}

/** Snooze until an instant (null clears). Hidden from Today/Inbox/Overdue until then. */
export function snoozeTask(userId: string, taskId: string, until: Date | null, ctx: MutationContext & { expectedVersion?: number } = {}) {
  return versionedAction('task.snooze', (tx, u, t, run) => doSnooze(tx, u, t, run, until))(userId, taskId, ctx);
}
