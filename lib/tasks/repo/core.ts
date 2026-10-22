// lib/tasks/repo/core.ts — transaction-scoped task operations. Each `do*`
// function runs inside a transaction the caller owns, writes the change and
// its TaskEvent(s), and is reused by single mutations, bulk apply and undo.
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/db/errors';
import type { Tx } from '@/lib/db/tx';
import type { Prisma } from '@/lib/generated/prisma/client';
import { addDays, diffDays, localDateOf, parseLocalDate, zonedParts, zonedTimeToUtc } from '@/lib/time';
import { formatRRule, nextOccurrence, parseRRule } from '../recurrence';
import type { CompletionWarning, CreateTaskInput, Task, TaskEventType, UpdateTaskPatch } from '../types';
import { OPEN_STATUSES } from '../types';
import {
  type TrackedField,
  diffTask,
  normalizeDescription,
  normalizeTags,
  normalizeTitle,
  validateDate,
  validateDue,
  validateEstimate,
  validatePriority,
  validateRecurrence,
  validateSourceRef,
  validateTimeZone,
} from '../validation';
import { type RunCtx, assertProjectOwned, casUpdate, isOpen, userTimeZone, writeEvent } from './internal';

export interface OpResult {
  task: Task;
  eventIds: string[];
}

// ───────────────────────── field resolution ─────────────────────────

/** Re-pins BYHOUR/BYMINUTE for a timed series from its (new) due instant. */
function pinRule(rule: string, dueAt: Date, dueHasTime: boolean, timeZone: string, keepExplicit: boolean): string {
  const parsed = parseRRule(rule);
  if (!dueHasTime) {
    delete parsed.byHour;
    delete parsed.byMinute;
    return formatRRule(parsed);
  }
  if (!keepExplicit || parsed.byHour === undefined) {
    const p = zonedParts(dueAt, timeZone);
    parsed.byHour = p.hour;
    parsed.byMinute = p.minute;
  }
  return formatRRule(parsed);
}

async function validateParent(tx: Tx, userId: string, taskId: string | null, parentId: string): Promise<void> {
  if (taskId && parentId === taskId) throw new ValidationError('INVALID_PARENT', 'A task cannot be its own subtask', 'parentId');
  const parent = await tx.task.findFirst({ where: { id: parentId, userId, deletedAt: null }, select: { id: true, parentId: true } });
  if (!parent) throw new NotFoundError('Task', parentId);
  if (parent.parentId) throw new ValidationError('SUBTASK_DEPTH', 'Subtasks are one level deep', 'parentId');
  if (taskId) {
    const children = await tx.task.count({ where: { parentId: taskId, userId, deletedAt: null } });
    if (children > 0) throw new ValidationError('SUBTASK_DEPTH', 'A task with subtasks cannot become a subtask', 'parentId');
  }
}

type Fields = Omit<UpdateTaskPatch, 'status'> & { status?: Task['status']; recurrenceSeriesId?: string | null };

/**
 * Validates `patch` against the current task (null on create) and returns the
 * Prisma data to write. Ownership of projectId / parentId is checked in `tx`.
 */
async function resolveFields(tx: Tx, userId: string, current: Task | null, patch: Fields): Promise<Prisma.TaskUncheckedUpdateInput> {
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = normalizeTitle(patch.title);
  if (patch.description !== undefined) data.description = normalizeDescription(patch.description);
  if (patch.priority !== undefined) data.priority = validatePriority(patch.priority);
  if (patch.estimateMinutes !== undefined) data.estimateMinutes = validateEstimate(patch.estimateMinutes);
  if (patch.tags !== undefined) data.tags = normalizeTags(patch.tags);
  if (patch.sourceRef !== undefined) data.sourceRef = validateSourceRef(patch.sourceRef);
  if (patch.timeZone !== undefined) data.timeZone = validateTimeZone(patch.timeZone);
  if (patch.startAt !== undefined) data.startAt = validateDate(patch.startAt, 'startAt');
  if (patch.snoozedUntil !== undefined) data.snoozedUntil = validateDate(patch.snoozedUntil, 'snoozedUntil');
  if (patch.dueAt !== undefined) data.dueAt = validateDate(patch.dueAt, 'dueAt');
  if (patch.dueHasTime !== undefined) data.dueHasTime = Boolean(patch.dueHasTime);
  if (patch.status !== undefined) data.status = patch.status;

  if (patch.projectId !== undefined) {
    if (patch.projectId !== null) await assertProjectOwned(tx, userId, patch.projectId);
    data.projectId = patch.projectId;
  }
  if (patch.parentId !== undefined) {
    if (patch.parentId !== null) await validateParent(tx, userId, current?.id ?? null, patch.parentId);
    data.parentId = patch.parentId;
  }

  const dueAt = (data.dueAt !== undefined ? data.dueAt : current?.dueAt ?? null) as Date | null;
  const dueHasTime = (data.dueHasTime !== undefined ? data.dueHasTime : current?.dueHasTime ?? false) as boolean;
  if (data.dueAt !== undefined || data.dueHasTime !== undefined) validateDue(dueAt, dueHasTime);

  // The task's zone is captured from preferences at creation (and when a
  // legacy task first needs one for a timed or recurring deadline).
  let timeZone = (data.timeZone as string | null | undefined) ?? current?.timeZone ?? null;
  if (!timeZone && (current === null || dueHasTime || patch.recurrenceRule)) timeZone = await userTimeZone(tx, userId);
  if (data.timeZone === undefined && timeZone !== (current?.timeZone ?? null)) data.timeZone = timeZone;

  // Recurrence: validate, require a due date, pin wall time for timed series.
  let rule = current?.recurrenceRule ?? null;
  const ruleTouched = patch.recurrenceRule !== undefined;
  if (ruleTouched) rule = validateRecurrence(patch.recurrenceRule);
  if (rule && (ruleTouched || data.dueAt !== undefined || data.dueHasTime !== undefined || data.timeZone !== undefined)) {
    if (!dueAt) throw new ValidationError('RECURRENCE_NEEDS_DUE', 'A recurring task needs a due date', 'recurrenceRule');
    data.recurrenceRule = pinRule(rule, dueAt, dueHasTime, timeZone ?? 'UTC', ruleTouched);
    if (!current?.recurrenceSeriesId) data.recurrenceSeriesId = patch.recurrenceSeriesId ?? randomUUID();
  } else if (ruleTouched) {
    data.recurrenceRule = null;
  }

  // Quick-capture rule: INBOX moves to TODO once it gets a date or a project.
  const status = (data.status ?? current?.status) as Task['status'] | undefined;
  if (status === 'INBOX' && patch.status === undefined && current !== null) {
    if ((data.dueAt !== undefined && data.dueAt !== null) || (data.projectId !== undefined && data.projectId !== null)) data.status = 'TODO';
  }
  return data as Prisma.TaskUncheckedUpdateInput;
}

function eventTypeFor(changed: TrackedField[]): TaskEventType {
  const only = (set: TrackedField[]) => changed.every((f) => set.includes(f));
  if (only(['projectId', 'parentId'])) return 'MOVED';
  if (only(['snoozedUntil'])) return 'SNOOZED';
  if (only(['status'])) return 'STATUS_CHANGED';
  return 'UPDATED';
}

// ───────────────────────── create / update ─────────────────────────

export async function doCreate(tx: Tx, userId: string, input: CreateTaskInput, run: RunCtx): Promise<OpResult> {
  const fields = await resolveFields(tx, userId, null, { ...input, status: input.status });
  if (fields.status === undefined) {
    const hasHome = input.projectId || input.dueAt || input.startAt || input.parentId;
    fields.status = hasHome ? 'TODO' : 'INBOX';
  }
  if (fields.status === 'DONE') fields.completedAt = run.now;
  const task = await tx.task.create({
    data: {
      ...(fields as Prisma.TaskUncheckedCreateInput),
      title: fields.title as string,
      userId,
      source: run.source ?? 'MANUAL',
      createdAt: run.now,
    },
  });
  const { after } = diffTask({}, task);
  const eventId = await writeEvent(tx, run, { userId, taskId: task.id, type: 'CREATED', taskVersion: task.version, before: null, after });
  return { task, eventIds: [eventId] };
}

export async function doUpdate(tx: Tx, userId: string, task: Task, patch: UpdateTaskPatch, run: RunCtx): Promise<OpResult> {
  if (patch.status !== undefined) {
    if (!(OPEN_STATUSES as readonly string[]).includes(patch.status)) {
      throw new ValidationError('INVALID_TRANSITION', 'Use complete, cancel or reopen to change to that status', 'status');
    }
    if (!isOpen(task.status)) throw new ValidationError('INVALID_TRANSITION', `Reopen the task before changing its status`, 'status');
  }
  const data = await resolveFields(tx, userId, task, patch);
  const { before, after, changed } = diffTask(task, data as Partial<Task>);
  if (changed.length === 0) return { task, eventIds: [] };
  const updated = await casUpdate(tx, userId, task, data as Prisma.TaskUpdateManyMutationInput, { deletedAt: null });
  const eventId = await writeEvent(tx, run, { userId, taskId: task.id, type: eventTypeFor(changed), taskVersion: updated.version, before, after });
  return { task: updated, eventIds: [eventId] };
}

// ───────────────────────── recurrence roll-over ─────────────────────────

async function openSibling(tx: Tx, userId: string, task: Task): Promise<Task | null> {
  if (!task.recurrenceSeriesId) return null;
  return tx.task.findFirst({
    where: { userId, recurrenceSeriesId: task.recurrenceSeriesId, id: { not: task.id }, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
  });
}

/** Creates the next occurrence of `task` (already closed in this tx), or null. */
async function rollRecurrence(tx: Tx, userId: string, task: Task, run: RunCtx): Promise<{ next: Task | null; eventIds: string[] }> {
  if (!task.recurrenceRule || !task.dueAt || !task.recurrenceSeriesId) return { next: null, eventIds: [] };
  if (await openSibling(tx, userId, task)) return { next: null, eventIds: [] }; // FR-231: one open instance per series
  const timeZone = task.timeZone ?? (await userTimeZone(tx, userId));
  const nextDue = nextOccurrence(task.recurrenceRule, { dueAt: task.dueAt, dueHasTime: task.dueHasTime, timeZone }, { now: run.now });
  if (!nextDue) return { next: null, eventIds: [] };

  let startAt: Date | null = null;
  if (task.startAt) {
    const dueDate = task.dueHasTime ? localDateOf(task.dueAt, timeZone) : task.dueAt.toISOString().slice(0, 10);
    const nextDate = task.dueHasTime ? localDateOf(nextDue, timeZone) : nextDue.toISOString().slice(0, 10);
    const shift = diffDays(dueDate, nextDate);
    const s = zonedParts(task.startAt, timeZone);
    const target = parseLocalDate(addDays(localDateOf(task.startAt, timeZone), shift));
    startAt = zonedTimeToUtc({ ...target, hour: s.hour, minute: s.minute }, timeZone);
  }

  const next = await tx.task.create({
    data: {
      userId,
      title: task.title,
      description: task.description,
      status: 'TODO',
      priority: task.priority,
      dueAt: nextDue,
      dueHasTime: task.dueHasTime,
      startAt,
      timeZone: task.timeZone,
      estimateMinutes: task.estimateMinutes,
      projectId: task.projectId,
      parentId: task.parentId,
      tags: task.tags,
      recurrenceRule: task.recurrenceRule,
      recurrenceSeriesId: task.recurrenceSeriesId,
      source: task.source,
      sourceRef: task.sourceRef,
      createdAt: run.now,
    },
  });
  const { after } = diffTask({}, next);
  const eventId = await writeEvent(tx, run, {
    userId,
    taskId: next.id,
    type: 'RECURRENCE_ROLLED',
    taskVersion: next.version,
    before: null,
    after: { ...after, fromTaskId: task.id },
  });
  return { next, eventIds: [eventId] };
}

/** Soft-deletes an untouched rolled occurrence so its predecessor can reopen. */
async function retireOccurrence(tx: Tx, userId: string, occurrence: Task, run: RunCtx, reason: string): Promise<string> {
  if (occurrence.version !== 1) throw new ConflictError('Task', 'SERIES_HAS_OPEN_OCCURRENCE', { id: occurrence.id });
  const updated = await casUpdate(tx, userId, occurrence, { deletedAt: run.now }, { deletedAt: null });
  return writeEvent(tx, run, {
    userId,
    taskId: occurrence.id,
    type: 'DELETED',
    taskVersion: updated.version,
    before: { deletedAt: null },
    after: { deletedAt: run.now.toISOString(), reason },
  });
}

// ───────────────────────── status transitions ─────────────────────────

export interface CompleteOutcome extends OpResult {
  alreadyCompleted: boolean;
  nextOccurrence: Task | null;
  warnings: CompletionWarning[];
}

export async function doComplete(tx: Tx, userId: string, task: Task, run: RunCtx, opts: { completeSubtasks?: boolean } = {}): Promise<CompleteOutcome> {
  if (task.status === 'DONE') return { task, eventIds: [], alreadyCompleted: true, nextOccurrence: null, warnings: [] };
  if (task.status === 'CANCELLED') throw new ValidationError('INVALID_TRANSITION', 'Reopen a cancelled task before completing it', 'status');

  let updated: Task;
  try {
    updated = await casUpdate(tx, userId, task, { status: 'DONE', completedAt: run.now }, { deletedAt: null, status: { in: [...OPEN_STATUSES] } });
  } catch (e) {
    // A concurrent completion won the race: completion is idempotent.
    if (e instanceof ConflictError) {
      const current = await tx.task.findFirst({ where: { id: task.id, userId } });
      if (current?.status === 'DONE') return { task: current, eventIds: [], alreadyCompleted: true, nextOccurrence: null, warnings: [] };
    }
    throw e;
  }

  const eventIds: string[] = [];
  const warnings: CompletionWarning[] = [];

  const subtasks = await tx.task.findMany({ where: { parentId: task.id, userId, deletedAt: null, status: { in: [...OPEN_STATUSES] } } });
  if (subtasks.length > 0) {
    if (opts.completeSubtasks) {
      for (const sub of subtasks) eventIds.push(...(await doComplete(tx, userId, sub, run)).eventIds);
    } else warnings.push('HAS_OPEN_SUBTASKS');
  }
  const blockers = await tx.taskDependency.count({
    where: { taskId: task.id, userId, dependsOn: { deletedAt: null, status: { in: [...OPEN_STATUSES] } } },
  });
  if (blockers > 0) warnings.push('BLOCKED_BY_OPEN_DEPENDENCY');

  const rolled = await rollRecurrence(tx, userId, updated, run);
  const eventId = await writeEvent(tx, run, {
    userId,
    taskId: task.id,
    type: 'COMPLETED',
    taskVersion: updated.version,
    before: { status: task.status, completedAt: null },
    after: { status: 'DONE', completedAt: run.now.toISOString(), nextOccurrenceId: rolled.next?.id ?? null },
  });
  return { task: updated, eventIds: [eventId, ...eventIds, ...rolled.eventIds], alreadyCompleted: false, nextOccurrence: rolled.next, warnings };
}

export async function doReopen(tx: Tx, userId: string, task: Task, run: RunCtx): Promise<OpResult> {
  if (isOpen(task.status)) return { task, eventIds: [] };
  const eventIds: string[] = [];
  let supersededOccurrenceId: string | null = null;
  const sibling = await openSibling(tx, userId, task);
  if (sibling) {
    eventIds.push(await retireOccurrence(tx, userId, sibling, run, 'SUPERSEDED_BY_REOPEN'));
    supersededOccurrenceId = sibling.id;
  }
  const updated = await casUpdate(tx, userId, task, { status: 'TODO', completedAt: null }, { deletedAt: null });
  const eventId = await writeEvent(tx, run, {
    userId,
    taskId: task.id,
    type: 'REOPENED',
    taskVersion: updated.version,
    before: { status: task.status, completedAt: task.completedAt?.toISOString() ?? null },
    after: { status: 'TODO', completedAt: null, supersededOccurrenceId },
  });
  return { task: updated, eventIds: [eventId, ...eventIds] };
}

export type RecurrenceScope = 'occurrence' | 'series';

export async function doCancel(tx: Tx, userId: string, task: Task, run: RunCtx, scope: RecurrenceScope = 'occurrence'): Promise<OpResult & { nextOccurrence: Task | null }> {
  if (task.status === 'CANCELLED') return { task, eventIds: [], nextOccurrence: null };
  if (task.status === 'DONE') throw new ValidationError('INVALID_TRANSITION', 'Reopen a completed task before cancelling it', 'status');
  const updated = await casUpdate(tx, userId, task, { status: 'CANCELLED' }, { deletedAt: null });
  const rolled = scope === 'occurrence' ? await rollRecurrence(tx, userId, updated, run) : { next: null, eventIds: [] };
  const eventId = await writeEvent(tx, run, {
    userId,
    taskId: task.id,
    type: 'STATUS_CHANGED',
    taskVersion: updated.version,
    before: { status: task.status },
    after: { status: 'CANCELLED', nextOccurrenceId: rolled.next?.id ?? null },
  });
  return { task: updated, eventIds: [eventId, ...rolled.eventIds], nextOccurrence: rolled.next };
}

// ───────────────────────── delete / restore ─────────────────────────

export async function doSoftDelete(tx: Tx, userId: string, task: Task, run: RunCtx, scope: RecurrenceScope = 'occurrence'): Promise<OpResult> {
  const eventIds: string[] = [];
  const updated = await casUpdate(tx, userId, task, { deletedAt: run.now }, { deletedAt: null });

  const reminders = await tx.reminder.findMany({ where: { taskId: task.id, userId, status: 'PENDING' }, select: { id: true } });
  if (reminders.length > 0) {
    await tx.reminder.updateMany({
      where: { id: { in: reminders.map((r) => r.id) }, userId, status: 'PENDING' },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
  }

  // FR-242: edges where other tasks wait on this one are removed and recorded in their history.
  const dependents = await tx.taskDependency.findMany({ where: { dependsOnId: task.id, userId } });
  for (const edge of dependents) {
    await tx.taskDependency.delete({ where: { taskId_dependsOnId: { taskId: edge.taskId, dependsOnId: edge.dependsOnId } } });
    const dependent = await tx.task.findFirst({ where: { id: edge.taskId, userId }, select: { version: true } });
    eventIds.push(
      await writeEvent(tx, run, {
        userId,
        taskId: edge.taskId,
        type: 'DEPENDENCY_REMOVED',
        taskVersion: dependent?.version ?? 1,
        before: { dependsOnId: task.id },
        after: { dependsOnId: null, reason: 'DEPENDENCY_DELETED' },
      }),
    );
  }

  const subtasks = await tx.task.findMany({ where: { parentId: task.id, userId, deletedAt: null } });
  for (const sub of subtasks) {
    const s = await casUpdate(tx, userId, sub, { deletedAt: run.now }, { deletedAt: null });
    eventIds.push(
      await writeEvent(tx, run, {
        userId,
        taskId: sub.id,
        type: 'DELETED',
        taskVersion: s.version,
        before: { deletedAt: null },
        after: { deletedAt: run.now.toISOString(), deletedWithParent: task.id },
      }),
    );
  }

  const rolled = scope === 'occurrence' && isOpen(task.status) ? await rollRecurrence(tx, userId, updated, run) : { next: null, eventIds: [] };
  const eventId = await writeEvent(tx, run, {
    userId,
    taskId: task.id,
    type: 'DELETED',
    taskVersion: updated.version,
    before: { deletedAt: null },
    after: {
      deletedAt: run.now.toISOString(),
      cancelledReminderIds: reminders.map((r) => r.id),
      removedDependentIds: dependents.map((d) => d.taskId),
      deletedSubtaskIds: subtasks.map((s) => s.id),
      nextOccurrenceId: rolled.next?.id ?? null,
    },
  });
  return { task: updated, eventIds: [eventId, ...eventIds, ...rolled.eventIds] };
}

interface DeletedDetails {
  cancelledReminderIds?: string[];
  removedDependentIds?: string[];
  deletedSubtaskIds?: string[];
  nextOccurrenceId?: string | null;
}

/**
 * Restores a soft-deleted task and what its deletion took with it (pending
 * reminders, dependent edges, subtasks). Used by restore and by undo of a
 * DELETED event.
 */
export async function doRestore(
  tx: Tx,
  userId: string,
  task: Task,
  run: RunCtx,
  opts: { details?: DeletedDetails; eventType?: 'RESTORED' | 'UNDONE'; revertsEventId?: string } = {},
): Promise<OpResult> {
  if (!task.deletedAt) return { task, eventIds: [] };
  const details = opts.details ?? {};
  const eventIds: string[] = [];

  if (isOpen(task.status)) {
    const sibling = await openSibling(tx, userId, task);
    if (sibling) {
      if (sibling.id !== details.nextOccurrenceId) throw new ConflictError('Task', 'SERIES_HAS_OPEN_OCCURRENCE', { id: sibling.id });
      eventIds.push(await retireOccurrence(tx, userId, sibling, run, 'SUPERSEDED_BY_RESTORE'));
    }
  }

  const updated = await casUpdate(tx, userId, task, { deletedAt: null });

  if (details.cancelledReminderIds?.length) {
    await tx.reminder.updateMany({
      where: { id: { in: details.cancelledReminderIds }, userId, taskId: task.id, status: 'CANCELLED', remindAt: { gt: run.now } },
      data: { status: 'PENDING', version: { increment: 1 } },
    });
  }
  for (const dependentId of details.removedDependentIds ?? []) {
    const dependent = await tx.task.findFirst({ where: { id: dependentId, userId, deletedAt: null }, select: { id: true, version: true } });
    if (!dependent) continue;
    await tx.taskDependency.createMany({ data: [{ taskId: dependentId, dependsOnId: task.id, userId }], skipDuplicates: true });
    eventIds.push(
      await writeEvent(tx, run, {
        userId,
        taskId: dependentId,
        type: 'DEPENDENCY_ADDED',
        taskVersion: dependent.version,
        before: { dependsOnId: null },
        after: { dependsOnId: task.id, reason: 'DEPENDENCY_RESTORED' },
      }),
    );
  }
  for (const subId of details.deletedSubtaskIds ?? []) {
    const sub = await tx.task.findFirst({ where: { id: subId, userId, parentId: task.id, deletedAt: { not: null } } });
    if (!sub) continue;
    const s = await casUpdate(tx, userId, sub, { deletedAt: null });
    eventIds.push(
      await writeEvent(tx, run, {
        userId,
        taskId: sub.id,
        type: 'RESTORED',
        taskVersion: s.version,
        before: { deletedAt: sub.deletedAt?.toISOString() ?? null },
        after: { deletedAt: null, restoredWithParent: task.id },
      }),
    );
  }

  const eventId = await writeEvent(tx, run, {
    userId,
    taskId: task.id,
    type: opts.eventType ?? 'RESTORED',
    taskVersion: updated.version,
    before: { deletedAt: task.deletedAt.toISOString() },
    after: { deletedAt: null },
    revertsEventId: opts.revertsEventId,
  });
  return { task: updated, eventIds: [eventId, ...eventIds] };
}

export async function latestDeletion(tx: Tx, userId: string, taskId: string): Promise<DeletedDetails | undefined> {
  const ev = await tx.taskEvent.findFirst({ where: { userId, taskId, type: 'DELETED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return (ev?.after as DeletedDetails | null) ?? undefined;
}

// ───────────────────────── archive / snooze ─────────────────────────

export async function doArchive(tx: Tx, userId: string, task: Task, run: RunCtx, archived: boolean): Promise<OpResult> {
  if (Boolean(task.archivedAt) === archived) return { task, eventIds: [] };
  const archivedAt = archived ? run.now : null;
  const updated = await casUpdate(tx, userId, task, { archivedAt }, { deletedAt: null });
  const eventId = await writeEvent(tx, run, {
    userId,
    taskId: task.id,
    type: archived ? 'ARCHIVED' : 'UNARCHIVED',
    taskVersion: updated.version,
    before: { archivedAt: task.archivedAt?.toISOString() ?? null },
    after: { archivedAt: archivedAt?.toISOString() ?? null },
  });
  return { task: updated, eventIds: [eventId] };
}

export async function doSnooze(tx: Tx, userId: string, task: Task, run: RunCtx, until: Date | null): Promise<OpResult> {
  validateDate(until, 'snoozedUntil');
  if (until && until <= run.now) throw new ValidationError('SNOOZE_IN_PAST', 'Snooze time must be in the future', 'snoozedUntil');
  return doUpdate(tx, userId, task, { snoozedUntil: until }, run);
}
