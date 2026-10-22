// lib/tasks/types.ts — public types of the task module (shared contract for
// routes, the command engine, the briefing job and the UI).
import type { Tx } from '@/lib/db/tx';
import type {
  ActorType,
  Reminder,
  ReminderChannel,
  Task,
  TaskEvent,
  TaskEventType,
  TaskSource,
  TaskStatus,
} from '@/lib/generated/prisma/client';

export type { Task, TaskEvent, Reminder, TaskStatus, TaskSource, TaskEventType, ActorType, ReminderChannel };

export const OPEN_STATUSES = ['INBOX', 'TODO', 'IN_PROGRESS'] as const satisfies readonly TaskStatus[];
export const PRIORITY = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 } as const;
export type PriorityName = keyof typeof PRIORITY;

/** Who/what is performing a mutation. Every mutation accepts one. */
export interface MutationContext {
  /** Where the change came from; stored on the TaskEvent (and on Task for creates). */
  source?: TaskSource;
  /** Defaults from source: MANUAL → USER, COMMAND/VOICE → AGENT, EMAIL/BRIEFING → SYSTEM. */
  actorType?: ActorType;
  /**
   * Caller-chosen idempotency key, unique per user. Replaying a mutation
   * with the same operationId returns the stored result (replayed: true)
   * and writes nothing.
   */
  operationId?: string;
  agentRunId?: string;
  proposedActionId?: string;
  requestId?: string;
  /** Shared by every event of one logical operation (set automatically when omitted). */
  batchId?: string;
  /** Join the caller's transaction (e.g. command executor). */
  tx?: Tx;
  /** Clock override for tests and jobs. */
  now?: Date;
}

export interface TaskMutationResult {
  task: Task;
  /** TaskEvent ids written; the first is the undo token. Empty for no-ops. */
  eventIds: string[];
  batchId: string;
  /** true when this result was returned for a repeated operationId. */
  replayed: boolean;
}

export interface SimilarTask {
  id: string;
  title: string;
  dueAt: Date | null;
  dueHasTime: boolean;
  score: number;
}

export interface CreateTaskResult extends TaskMutationResult {
  /** FR-214 duplicate hint: open tasks with a similar normalised title. */
  similar: SimilarTask[];
}

export type CompletionWarning = 'BLOCKED_BY_OPEN_DEPENDENCY' | 'HAS_OPEN_SUBTASKS';

export interface CompleteTaskResult extends TaskMutationResult {
  /** The task was already DONE: nothing was written. */
  alreadyCompleted: boolean;
  /** Next occurrence generated for a recurring task, if any. */
  nextOccurrence: Task | null;
  warnings: CompletionWarning[];
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: number;
  /** Timed deadline (dueHasTime=true) or floating date at 00:00Z (dueHasTime=false). */
  dueAt?: Date | null;
  dueHasTime?: boolean;
  startAt?: Date | null;
  timeZone?: string | null;
  estimateMinutes?: number | null;
  projectId?: string | null;
  parentId?: string | null;
  tags?: string[];
  recurrenceRule?: string | null;
  snoozedUntil?: Date | null;
  sourceRef?: string | null;
}

export interface UpdateTaskPatch {
  title?: string;
  description?: string | null;
  /** Only open statuses; use complete/cancel/reopen for the others. */
  status?: 'INBOX' | 'TODO' | 'IN_PROGRESS';
  priority?: number;
  dueAt?: Date | null;
  dueHasTime?: boolean;
  startAt?: Date | null;
  timeZone?: string | null;
  estimateMinutes?: number | null;
  projectId?: string | null;
  parentId?: string | null;
  tags?: string[];
  recurrenceRule?: string | null;
  snoozedUntil?: Date | null;
  sourceRef?: string | null;
}

// ───────────────────────── views, filters, search ─────────────────────────

export type TaskViewKind = 'today' | 'upcoming' | 'inbox' | 'overdue' | 'completed' | 'all' | 'project' | 'trash';

export type TaskSort = 'default' | 'due' | 'priority' | 'created' | 'updated' | 'title';

export interface TaskFilter {
  status?: TaskStatus[];
  /** Exact priorities, or a minimum. */
  priority?: number[];
  minPriority?: number;
  /** null = tasks without a project. */
  projectId?: string | null;
  /** Task must carry all of these tags (lower-cased). */
  tags?: string[];
  /** Task must carry at least one of these tags. */
  anyTags?: string[];
  dueFrom?: Date;
  dueTo?: Date;
  /**
   * Due on local calendar days [from, toExclusive) in `timeZone`: timed tasks
   * by instant, date-only tasks by their floating date.
   */
  dueOn?: { from: string; toExclusive: string; timeZone: string };
  /** true = only tasks with a due date, false = only without. */
  hasDue?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
  completedFrom?: Date;
  completedTo?: Date;
  source?: TaskSource[];
  sourceRef?: string;
  parentId?: string | null;
  recurrenceSeriesId?: string;
  includeArchived?: boolean;
}

export interface ListOptions {
  cursor?: string | null;
  /** 1–200, default 50. */
  limit?: number;
  sort?: TaskSort;
  filter?: TaskFilter;
  /** Defaults to the user's preference time zone. */
  timeZone?: string;
  now?: Date;
  tx?: Tx;
}

export interface TaskViewSpec {
  kind: TaskViewKind;
  /** Required for kind 'project'. */
  projectId?: string;
  /** Upcoming: days grouped individually before "later" (default 14). */
  days?: number;
}

export interface TaskListItem {
  task: Task;
  /** View group: 'overdue' | 'today' | 'YYYY-MM-DD' | 'later' | a status | null. */
  group: string | null;
}

export interface TaskPage {
  items: TaskListItem[];
  nextCursor: string | null;
}

export interface SearchOptions extends ListOptions {
  text?: string;
}

// ───────────────────────── bulk ─────────────────────────

export type BulkSelector = { ids: string[] } | { filter: TaskFilter; view?: TaskViewSpec };

export interface BulkChange {
  complete?: true;
  cancel?: true;
  reopen?: true;
  delete?: true;
  status?: 'INBOX' | 'TODO' | 'IN_PROGRESS';
  priority?: number;
  dueAt?: Date | null;
  dueHasTime?: boolean;
  /** Move each task's due date by N days (keeps date-only/timed). */
  shiftDueDays?: number;
  projectId?: string | null;
  addTags?: string[];
  removeTags?: string[];
  snoozedUntil?: Date | null;
}

export interface BulkTargetPreview {
  id: string;
  title: string;
  version: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface BulkPreview {
  count: number;
  targets: BulkTargetPreview[];
  /** Pass back to applyBulkUpdate as `expected` to freeze the target set. */
  expected: { id: string; version: number }[];
}

export interface BulkApplyResult {
  batchId: string;
  tasks: Task[];
  eventIds: string[];
  replayed: boolean;
}
