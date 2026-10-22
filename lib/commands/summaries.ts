// lib/commands/summaries.ts — what the model and the user see for a task:
// handles instead of ids, human-local dates instead of ISO (docs/04 §5).
import { listProjects } from '@/lib/projects/repo';
import type { Task } from '@/lib/tasks/repo';
import { floatingToLocalDate, localDateOf } from '@/lib/time';
import { dateLabel, instantLabel } from './dates';
import { issueHandle, type RunState } from './run-state';

export const PRIORITY_NAMES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type PriorityName = (typeof PRIORITY_NAMES)[number];

export interface TaskSummary {
  handle: string;
  title: string;
  status: Task['status'];
  due: string | null;
  priority: PriorityName;
  project: string | null;
  source: Task['source'];
}

export function dueLabel(task: Pick<Task, 'dueAt' | 'dueHasTime'>, state: Pick<RunState, 'prefs' | 'now'>): string | null {
  if (!task.dueAt) return null;
  const tz = state.prefs.timeZone;
  if (task.dueHasTime) return instantLabel(task.dueAt, tz, state.now);
  return dateLabel(floatingToLocalDate(task.dueAt), state.now, tz);
}

/** "due today" / "due Fri 24 Oct" / "no date". */
export function dueDetail(task: Pick<Task, 'dueAt' | 'dueHasTime'>, state: Pick<RunState, 'prefs' | 'now'>): string {
  if (!task.dueAt) return 'no date';
  const today = localDateOf(state.now, state.prefs.timeZone);
  const date = task.dueHasTime ? localDateOf(task.dueAt, state.prefs.timeZone) : floatingToLocalDate(task.dueAt);
  if (date === today) return 'due today';
  if (date < today) return `overdue since ${dateLabel(date, state.now, state.prefs.timeZone)}`;
  return `due ${dueLabel(task, state)}`;
}

const projectCache = new WeakMap<RunState, Promise<Map<string, string>>>();

export function projectNames(state: RunState): Promise<Map<string, string>> {
  let p = projectCache.get(state);
  if (!p) {
    p = listProjects(state.userId, { includeArchived: true }).then((rows) => new Map(rows.map((r) => [r.id, r.name])));
    projectCache.set(state, p);
  }
  return p;
}

export async function summarizeTask(state: RunState, task: Task, opts: { userDerived?: boolean; setHandle?: string } = {}): Promise<TaskSummary> {
  const projects = await projectNames(state);
  const handle = issueHandle(state, 'tsk', task.id, {
    type: 'task',
    taskId: task.id,
    userDerived: opts.userDerived ?? false,
    ...(opts.setHandle ? { setHandle: opts.setHandle } : {}),
  });
  return {
    handle,
    title: task.title,
    status: task.status,
    due: dueLabel(task, state),
    priority: PRIORITY_NAMES[task.priority] ?? 'NONE',
    project: task.projectId ? (projects.get(task.projectId) ?? null) : null,
    source: task.source,
  };
}

/** Option detail that tells identical titles apart (docs/04 §8.3 A). */
export async function optionDetail(state: RunState, task: Task): Promise<string> {
  const projects = await projectNames(state);
  const project = task.projectId ? (projects.get(task.projectId) ?? 'No project') : 'No project';
  const when = task.dueAt ? dueDetail(task, state) : `created ${dateLabel(localDateOf(task.createdAt, state.prefs.timeZone), state.now, state.prefs.timeZone)}`;
  return `${project} · ${when}`;
}
