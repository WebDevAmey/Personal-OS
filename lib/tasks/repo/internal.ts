// lib/tasks/repo/internal.ts — shared plumbing for the task repository:
// the mutation runner (transaction + operationId idempotency), event writing
// and ownership-scoped loads. Not part of the module's public surface.
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '@/lib/db/errors';
import { type Tx, withTransaction } from '@/lib/db/tx';
import type { Prisma } from '@/lib/generated/prisma/client';
import type { MutationContext, Task, TaskEventType } from '../types';
import { OPEN_STATUSES } from '../types';
import { actorFor } from '../validation';

export interface RunCtx extends MutationContext {
  batchId: string;
  now: Date;
}

/**
 * Runs a mutation in one transaction. With `ctx.operationId`, the operation
 * is claimed first via INSERT … ON CONFLICT DO NOTHING on (userId,
 * operationId): a concurrent duplicate blocks on that insert until the first
 * commits, then sees the claim and replays the stored result instead of
 * applying the change again.
 */
export async function runMutation<R>(
  userId: string,
  ctx: MutationContext,
  kind: string,
  work: (tx: Tx, run: RunCtx) => Promise<R>,
  codec: { store: (r: R) => Prisma.InputJsonValue; replay: (tx: Tx, stored: Record<string, unknown>) => Promise<R> },
): Promise<R> {
  const run: RunCtx = { ...ctx, batchId: ctx.batchId ?? randomUUID(), now: ctx.now ?? new Date() };
  return withTransaction(
    async (tx) => {
      if (ctx.operationId) {
        const claim = await tx.taskOperation.createMany({
          data: [{ userId, operationId: ctx.operationId, kind }],
          skipDuplicates: true,
        });
        if (claim.count === 0) {
          const existing = await tx.taskOperation.findUnique({
            where: { userId_operationId: { userId, operationId: ctx.operationId } },
          });
          if (!existing || existing.kind !== kind) throw new ConflictError('TaskOperation', 'OPERATION_ID_REUSED');
          if (existing.result === null) throw new ConflictError('TaskOperation', 'OPERATION_INCOMPLETE');
          return codec.replay(tx, existing.result as Record<string, unknown>);
        }
      }
      const result = await work(tx, run);
      if (ctx.operationId) {
        await tx.taskOperation.update({
          where: { userId_operationId: { userId, operationId: ctx.operationId } },
          data: { result: codec.store(result) },
        });
      }
      return result;
    },
    { tx: ctx.tx },
  );
}

export interface EventInput {
  userId: string;
  taskId: string;
  type: TaskEventType;
  taskVersion: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  revertsEventId?: string;
}

export async function writeEvent(tx: Tx, run: RunCtx, e: EventInput): Promise<string> {
  const row = await tx.taskEvent.create({
    data: {
      userId: e.userId,
      taskId: e.taskId,
      type: e.type,
      actorType: run.actorType ?? actorFor(run.source),
      source: run.source ?? 'MANUAL',
      agentRunId: run.agentRunId ?? null,
      proposedActionId: run.proposedActionId ?? null,
      operationId: run.operationId ?? null,
      batchId: run.batchId,
      requestId: run.requestId ?? null,
      revertsEventId: e.revertsEventId ?? null,
      before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
      taskVersion: e.taskVersion,
      createdAt: run.now,
    },
    select: { id: true },
  });
  return row.id;
}

/** Loads a task owned by `userId`; another user's id behaves like a missing one. */
export async function loadOwnedTask(tx: Tx, userId: string, id: string, opts: { includeDeleted?: boolean } = {}): Promise<Task> {
  if (typeof id !== 'string' || id.length === 0) throw new NotFoundError('Task', id);
  const task = await tx.task.findFirst({
    where: { id, userId, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
  });
  if (!task) throw new NotFoundError('Task', id);
  return task;
}

/**
 * Optimistic write (ADR-006): updateMany where {id, userId, version}. On
 * count 0 one follow-up read tells NotFound and Conflict apart.
 */
export async function casUpdate(
  tx: Tx,
  userId: string,
  task: Pick<Task, 'id' | 'version'>,
  data: Prisma.TaskUpdateManyMutationInput,
  extraWhere: Prisma.TaskWhereInput = {},
): Promise<Task> {
  const res = await tx.task.updateMany({
    where: { id: task.id, userId, version: task.version, ...extraWhere },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count === 0) {
    const current = await tx.task.findFirst({ where: { id: task.id, userId }, select: { version: true } });
    if (!current) throw new NotFoundError('Task', task.id);
    throw new ConflictError('Task', 'VERSION_MISMATCH', { id: task.id, currentVersion: current.version, expectedVersion: task.version });
  }
  return tx.task.findFirstOrThrow({ where: { id: task.id, userId } });
}

export function assertVersion(task: Task, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && task.version !== expectedVersion) {
    throw new ConflictError('Task', 'VERSION_MISMATCH', { id: task.id, currentVersion: task.version, expectedVersion });
  }
}

export function isOpen(status: Task['status']): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** Retries `fn` when a concurrent writer bumped the version (used by actions that take no expectedVersion). */
export async function retryOnVersionConflict<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i < attempts - 1 && e instanceof ConflictError && e.reason === 'VERSION_MISMATCH') continue;
      throw e;
    }
  }
}

export async function userTimeZone(tx: Tx, userId: string): Promise<string> {
  const pref = await tx.userPreference.findUnique({ where: { userId }, select: { timeZone: true } });
  return pref?.timeZone ?? 'UTC';
}

export async function assertProjectOwned(tx: Tx, userId: string, projectId: string): Promise<void> {
  const project = await tx.project.findFirst({ where: { id: projectId, userId, deletedAt: null }, select: { id: true } });
  if (!project) throw new NotFoundError('Project', projectId);
}

export function storedTaskResult(r: { task: Task; eventIds: string[]; batchId: string }, extra: Record<string, unknown> = {}) {
  return { taskId: r.task.id, eventIds: r.eventIds, batchId: r.batchId, ...extra } as Prisma.InputJsonValue;
}
