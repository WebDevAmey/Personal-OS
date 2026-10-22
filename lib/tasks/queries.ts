// lib/tasks/queries.ts — compatibility adapter (deprecated).
//
// Keeps the pre-v2 exported signatures (Drizzle-era shape: notes, dueDate,
// status 'open' | 'completed' | 'deleted') for consumers that have not moved
// to lib/tasks/repo.ts yet. Everything goes through the ownership-safe repo,
// so these calls write TaskEvents and enforce userId scoping too.
// New code must import from '@/lib/tasks/repo'.
import { floatingDate, floatingToLocalDate, isFloatingDate } from '@/lib/time';
import { completeTask as repoComplete, createTask as repoCreate, getTask, listTasks, searchTasks as repoSearch, softDeleteTask, updateTask as repoUpdate } from './repo';
import type { Task, TaskFilter, TaskStatus } from './types';

export type LegacyTaskStatus = 'open' | 'completed' | 'deleted';

/** Same shape as the old Drizzle `Task` row. */
export interface LegacyTask {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  dueDate: Date | null;
  status: LegacyTaskStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toLegacyTask(t: Task): LegacyTask {
  return {
    id: t.id,
    userId: t.userId,
    title: t.title,
    notes: t.description,
    dueDate: t.dueAt,
    status: t.deletedAt ? 'deleted' : t.status === 'DONE' || t.status === 'CANCELLED' ? 'completed' : 'open',
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** Legacy callers pass full datetimes; exact UTC midnight is a date-only deadline (as in the migration). */
function legacyDue(dueDate: Date | undefined): { dueAt?: Date; dueHasTime?: boolean } {
  if (!dueDate) return {};
  return isFloatingDate(dueDate) ? { dueAt: floatingDate(floatingToLocalDate(dueDate)), dueHasTime: false } : { dueAt: dueDate, dueHasTime: true };
}

export async function createTask(userId: string, input: { title: string; dueDate?: Date; notes?: string }): Promise<LegacyTask> {
  const r = await repoCreate(userId, { title: input.title, description: input.notes ?? null, ...legacyDue(input.dueDate) }, { source: 'COMMAND', detectDuplicates: false });
  return toLegacyTask(r.task);
}

export async function updateTask(userId: string, taskId: string, input: { title?: string; dueDate?: Date; notes?: string }): Promise<LegacyTask> {
  const current = await getTask(userId, taskId);
  const r = await repoUpdate(
    userId,
    taskId,
    current.version,
    { title: input.title, description: input.notes, ...legacyDue(input.dueDate) },
    { source: 'COMMAND' },
  );
  return toLegacyTask(r.task);
}

export async function completeTask(userId: string, taskId: string): Promise<LegacyTask> {
  return toLegacyTask((await repoComplete(userId, taskId, { source: 'COMMAND' })).task);
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  await softDeleteTask(userId, taskId, { source: 'COMMAND' });
}

const STATUS_MAP: Record<Exclude<LegacyTaskStatus, 'deleted'>, TaskStatus[]> = {
  open: ['INBOX', 'TODO', 'IN_PROGRESS'],
  completed: ['DONE', 'CANCELLED'],
};

export async function searchTasks(
  userId: string,
  filter: { query?: string; status?: LegacyTaskStatus; dueBefore?: Date },
): Promise<LegacyTask[]> {
  const f: TaskFilter = { includeArchived: true };
  if (filter.status && filter.status !== 'deleted') f.status = STATUS_MAP[filter.status];
  if (filter.dueBefore) f.dueTo = new Date(filter.dueBefore.getTime() + 1); // legacy filter was inclusive (<=)
  const page =
    filter.status === 'deleted'
      ? await listTasks(userId, { kind: 'trash' }, { filter: f, limit: 200 })
      : filter.query
        ? await repoSearch(userId, { text: filter.query, filter: f, limit: 200 })
        : await listTasks(userId, { kind: 'all' }, { filter: f, limit: 200 });
  let tasks = page.items.map((i) => i.task);
  // Legacy semantics: substring match on the title (search above is word-prefix based).
  if (filter.query && filter.status === 'deleted') {
    const q = filter.query.toLowerCase();
    tasks = tasks.filter((t) => t.title.toLowerCase().includes(q));
  }
  return tasks.map(toLegacyTask);
}
