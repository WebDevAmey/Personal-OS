// components/tasks/types.ts — JSON shapes the task API returns to the browser.
// Client-safe: no server imports. Local dates/times are computed on the
// server in the user's time zone, so the UI never does zone arithmetic.

export type TaskStatusName = 'INBOX' | 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskSourceName = 'MANUAL' | 'COMMAND' | 'VOICE' | 'EMAIL' | 'BRIEFING';

/** A calendar date (YYYY-MM-DD) with an optional wall time (HH:mm) in the user's zone. */
export interface LocalDateTime {
  date: string;
  time: string | null;
}

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatusName;
  priority: number;
  dueAt: string | null;
  dueHasTime: boolean;
  due: LocalDateTime | null;
  start: LocalDateTime | null;
  estimateMinutes: number | null;
  projectId: string | null;
  parentId: string | null;
  tags: string[];
  recurrenceRule: string | null;
  recurrenceText: string | null;
  snoozedUntil: string | null;
  source: TaskSourceName;
  sourceRef: string | null;
  completedAt: string | null;
  deletedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  isOverdue: boolean;
  isDueToday: boolean;
}

export interface TaskListItemDTO {
  task: TaskDTO;
  group: string | null;
}

export interface TaskPageDTO {
  items: TaskListItemDTO[];
  nextCursor: string | null;
  today: string;
}

export interface ReminderDTO {
  id: string;
  remindAt: string;
  local: LocalDateTime;
  status: string;
  channel: string;
}

export interface TaskEventDTO {
  id: string;
  type: string;
  actorType: string;
  source: TaskSourceName;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  batchId: string | null;
  undone: boolean;
}

export interface TaskDetailDTO {
  task: TaskDTO;
  subtasks: TaskDTO[];
  dependsOn: TaskDTO[];
  blocks: TaskDTO[];
  openBlockerIds: string[];
  subtaskProgress: { done: number; total: number };
  reminders: ReminderDTO[];
}

export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  openTaskCount: number;
  archivedAt: string | null;
  version: number;
}

/** Error body every task/project/preferences/memory route returns. */
export interface ApiErrorBody {
  error: string;
  code: string;
  field?: string;
  issues?: { path: string; message: string }[];
  currentVersion?: number;
}

export const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
};
