// lib/tasks/repo/relations.ts — subtasks and dependencies (FR-240..242).
import { NotFoundError, ValidationError } from '@/lib/db/errors';
import { type Tx, reader } from '@/lib/db/tx';
import type { MutationContext, Task, TaskMutationResult } from '../types';
import { OPEN_STATUSES } from '../types';
import { type RunCtx, loadOwnedTask, runMutation, storedTaskResult, writeEvent } from './internal';

/** Serialises dependency writes per user so two concurrent edges cannot form a cycle. */
async function lockUserGraph(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`task-deps:${userId}`}))`;
}

/** True when `from` already (transitively) depends on `to`. */
async function reaches(tx: Tx, userId: string, from: string, to: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ found: boolean }[]>`
    WITH RECURSIVE reach(id) AS (
      SELECT "dependsOnId" FROM "TaskDependency" WHERE "taskId" = ${from} AND "userId" = ${userId}
      UNION
      SELECT d."dependsOnId" FROM "TaskDependency" d JOIN reach r ON d."taskId" = r.id WHERE d."userId" = ${userId}
    )
    SELECT EXISTS (SELECT 1 FROM reach WHERE id = ${to}) AS found`;
  return Boolean(rows[0]?.found);
}

export async function doAddDependency(tx: Tx, userId: string, taskId: string, dependsOnId: string, run: RunCtx) {
  if (taskId === dependsOnId) throw new ValidationError('DEPENDENCY_CYCLE', 'A task cannot depend on itself', 'dependsOnId');
  await lockUserGraph(tx, userId);
  const task = await loadOwnedTask(tx, userId, taskId);
  await loadOwnedTask(tx, userId, dependsOnId);
  const existing = await tx.taskDependency.findUnique({ where: { taskId_dependsOnId: { taskId, dependsOnId } } });
  if (existing) return { task, eventIds: [] as string[] };
  if (await reaches(tx, userId, dependsOnId, taskId)) {
    throw new ValidationError('DEPENDENCY_CYCLE', 'That dependency would create a cycle', 'dependsOnId');
  }
  await tx.taskDependency.create({ data: { taskId, dependsOnId, userId, createdAt: run.now } });
  const eventId = await writeEvent(tx, run, {
    userId,
    taskId,
    type: 'DEPENDENCY_ADDED',
    taskVersion: task.version,
    before: { dependsOnId: null },
    after: { dependsOnId },
  });
  return { task, eventIds: [eventId] };
}

export async function doRemoveDependency(tx: Tx, userId: string, taskId: string, dependsOnId: string, run: RunCtx) {
  const task = await loadOwnedTask(tx, userId, taskId, { includeDeleted: true });
  const res = await tx.taskDependency.deleteMany({ where: { taskId, dependsOnId, userId } });
  if (res.count === 0) throw new NotFoundError('TaskDependency', `${taskId}->${dependsOnId}`);
  const eventId = await writeEvent(tx, run, {
    userId,
    taskId,
    type: 'DEPENDENCY_REMOVED',
    taskVersion: task.version,
    before: { dependsOnId },
    after: { dependsOnId: null },
  });
  return { task, eventIds: [eventId] };
}

const codec = (userId: string) => ({
  store: (r: TaskMutationResult) => storedTaskResult(r),
  replay: async (tx: Tx, s: Record<string, unknown>) => ({
    task: await loadOwnedTask(tx, userId, s.taskId as string, { includeDeleted: true }),
    eventIds: s.eventIds as string[],
    batchId: s.batchId as string,
    replayed: true,
  }),
});

/** `taskId` waits on `dependsOnId`. Both must belong to `userId`; cycles are rejected. Idempotent. */
export function addDependency(userId: string, taskId: string, dependsOnId: string, ctx: MutationContext = {}): Promise<TaskMutationResult> {
  return runMutation(
    userId,
    ctx,
    'task.dependency.add',
    async (tx, run) => ({ ...(await doAddDependency(tx, userId, taskId, dependsOnId, run)), batchId: run.batchId, replayed: false }),
    codec(userId),
  );
}

export function removeDependency(userId: string, taskId: string, dependsOnId: string, ctx: MutationContext = {}): Promise<TaskMutationResult> {
  return runMutation(
    userId,
    ctx,
    'task.dependency.remove',
    async (tx, run) => ({ ...(await doRemoveDependency(tx, userId, taskId, dependsOnId, run)), batchId: run.batchId, replayed: false }),
    codec(userId),
  );
}

export interface TaskRelations {
  /** Tasks this one waits on. */
  dependsOn: Task[];
  /** Tasks waiting on this one. */
  blocks: Task[];
  /** Open (unfinished) dependencies: drives the "Blocked by X" badge. */
  openBlockers: Task[];
  subtasks: Task[];
  /** "2/5" progress for the parent row. */
  subtaskProgress: { done: number; total: number };
}

export async function getTaskRelations(userId: string, taskId: string, opts: { tx?: Tx } = {}): Promise<TaskRelations> {
  const tx = reader(opts.tx);
  await loadOwnedTask(tx, userId, taskId, { includeDeleted: true });
  const [deps, blocks, subtasks] = await Promise.all([
    tx.taskDependency.findMany({ where: { taskId, userId, dependsOn: { deletedAt: null } }, include: { dependsOn: true } }),
    tx.taskDependency.findMany({ where: { dependsOnId: taskId, userId, task: { deletedAt: null } }, include: { task: true } }),
    tx.task.findMany({ where: { parentId: taskId, userId, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ]);
  const dependsOn = deps.map((d) => d.dependsOn);
  const counted = subtasks.filter((s) => s.status !== 'CANCELLED');
  return {
    dependsOn,
    blocks: blocks.map((b) => b.task),
    openBlockers: dependsOn.filter((t) => (OPEN_STATUSES as readonly string[]).includes(t.status)),
    subtasks,
    subtaskProgress: { done: counted.filter((s) => s.status === 'DONE').length, total: counted.length },
  };
}

export async function listSubtasks(userId: string, parentId: string, opts: { tx?: Tx } = {}): Promise<Task[]> {
  return (await getTaskRelations(userId, parentId, opts)).subtasks;
}
