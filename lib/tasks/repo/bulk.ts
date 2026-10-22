// lib/tasks/repo/bulk.ts — bulk actions (FR-260/261, TASK-007).
//
// previewBulkUpdate() evaluates the selector and returns per-task before/after
// without writing anything. applyBulkUpdate() takes the same selector and
// change; when given the preview's `expected` list it refuses (CONFLICT, no
// writes) if the target set or any version changed since the preview. All
// tasks change in one transaction and share one batchId (one Undo).
import { NotFoundError, ConflictError, ValidationError } from '@/lib/db/errors';
import { type Tx, reader } from '@/lib/db/tx';
import type { Prisma } from '@/lib/generated/prisma/client';
import { recordAudit } from '@/lib/audit/audit-events';
import { addDays, floatingDate, floatingToLocalDate, localDateOf, parseLocalDate, zonedParts, zonedTimeToUtc } from '@/lib/time';
import type { BulkApplyResult, BulkChange, BulkPreview, BulkSelector, MutationContext, Task, UpdateTaskPatch } from '../types';
import { diffTask, normalizeTag } from '../validation';
import { doCancel, doComplete, doReopen, doSoftDelete, doUpdate } from './core';
import { runMutation, userTimeZone } from './internal';
import { filterWhere, listTasks } from './views';

export const BULK_MAX = 500;

async function resolveTargets(tx: Tx, userId: string, selector: BulkSelector, opts: { now: Date; timeZone?: string; max: number }): Promise<Task[]> {
  if ('ids' in selector) {
    const ids = [...new Set(selector.ids)];
    if (ids.length === 0) return [];
    if (ids.length > opts.max) throw new ValidationError('BULK_LIMIT', `At most ${opts.max} tasks per bulk action`, 'ids');
    const tasks = await tx.task.findMany({ where: { id: { in: ids }, userId, deletedAt: null }, orderBy: { id: 'asc' } });
    if (tasks.length !== ids.length) {
      const found = new Set(tasks.map((t) => t.id));
      throw new NotFoundError('Task', ids.find((id) => !found.has(id)));
    }
    return tasks;
  }
  if (selector.view) {
    const out: Task[] = [];
    let cursor: string | null = null;
    do {
      const page = await listTasks(userId, selector.view, { filter: selector.filter, cursor, limit: 200, now: opts.now, timeZone: opts.timeZone, tx });
      out.push(...page.items.map((i) => i.task));
      cursor = page.nextCursor;
      if (out.length > opts.max) throw new ValidationError('BULK_LIMIT', `At most ${opts.max} tasks per bulk action`, 'filter');
    } while (cursor);
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  const tasks = await tx.task.findMany({
    where: { AND: [{ userId, deletedAt: null }, ...(selector.filter.includeArchived ? [] : [{ archivedAt: null }]), ...filterWhere(selector.filter)] },
    orderBy: { id: 'asc' },
    take: opts.max + 1,
  });
  if (tasks.length > opts.max) throw new ValidationError('BULK_LIMIT', `At most ${opts.max} tasks per bulk action`, 'filter');
  return tasks;
}

function validateChange(change: BulkChange): void {
  const actions = [change.complete, change.cancel, change.reopen, change.delete].filter(Boolean).length;
  if (actions > 1) throw new ValidationError('BULK_CHANGE', 'Choose one of complete, cancel, reopen or delete', 'change');
  if (change.dueAt !== undefined && change.shiftDueDays !== undefined) {
    throw new ValidationError('BULK_CHANGE', 'Use either dueAt or shiftDueDays', 'change');
  }
  const keys = Object.entries(change).filter(([, v]) => v !== undefined);
  if (keys.length === 0) throw new ValidationError('BULK_CHANGE', 'Nothing to change', 'change');
}

/** The field patch a bulk change implies for one task (status actions excluded). */
function patchFor(task: Task, change: BulkChange, timeZone: string): UpdateTaskPatch {
  const patch: UpdateTaskPatch = {};
  if (change.status !== undefined) patch.status = change.status;
  if (change.priority !== undefined) patch.priority = change.priority;
  if (change.projectId !== undefined) patch.projectId = change.projectId;
  if (change.snoozedUntil !== undefined) patch.snoozedUntil = change.snoozedUntil;
  if (change.dueAt !== undefined) {
    patch.dueAt = change.dueAt;
    patch.dueHasTime = change.dueHasTime ?? task.dueHasTime;
  }
  if (change.shiftDueDays !== undefined && task.dueAt) {
    if (task.dueHasTime) {
      const tz = task.timeZone ?? timeZone;
      const wall = zonedParts(task.dueAt, tz);
      const day = parseLocalDate(addDays(localDateOf(task.dueAt, tz), change.shiftDueDays));
      patch.dueAt = zonedTimeToUtc({ ...day, hour: wall.hour, minute: wall.minute }, tz);
    } else {
      patch.dueAt = floatingDate(addDays(floatingToLocalDate(task.dueAt), change.shiftDueDays));
    }
  }
  if (change.addTags?.length || change.removeTags?.length) {
    const remove = new Set((change.removeTags ?? []).map(normalizeTag));
    patch.tags = [...new Set([...task.tags, ...(change.addTags ?? []).map(normalizeTag)])].filter((t) => !remove.has(t));
  }
  return patch;
}

function previewAfter(task: Task, change: BulkChange, timeZone: string, now: Date): Partial<Task> {
  const after: Partial<Task> = { ...(patchFor(task, change, timeZone) as Partial<Task>) };
  if (change.complete) Object.assign(after, { status: 'DONE', completedAt: task.status === 'DONE' ? task.completedAt : now });
  if (change.cancel) after.status = 'CANCELLED';
  if (change.reopen) Object.assign(after, { status: 'TODO', completedAt: null });
  if (change.delete) after.deletedAt = now;
  return after;
}

export async function previewBulkUpdate(
  userId: string,
  selector: BulkSelector,
  change: BulkChange,
  opts: { now?: Date; timeZone?: string; max?: number; tx?: Tx } = {},
): Promise<BulkPreview> {
  validateChange(change);
  const tx = reader(opts.tx);
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? (await userTimeZone(tx, userId));
  const targets = await resolveTargets(tx, userId, selector, { now, timeZone, max: opts.max ?? BULK_MAX });
  return {
    count: targets.length,
    targets: targets.map((t) => {
      const { before, after } = diffTask(t, previewAfter(t, change, timeZone, now));
      return { id: t.id, title: t.title, version: t.version, before, after };
    }),
    expected: targets.map((t) => ({ id: t.id, version: t.version })),
  };
}

export async function applyBulkUpdate(
  userId: string,
  selector: BulkSelector,
  change: BulkChange,
  ctx: MutationContext & { expected?: { id: string; version: number }[]; timeZone?: string; max?: number } = {},
): Promise<BulkApplyResult> {
  validateChange(change);
  return runMutation<BulkApplyResult>(
    userId,
    ctx,
    'task.bulk',
    async (tx, run) => {
      const timeZone = ctx.timeZone ?? (await userTimeZone(tx, userId));
      const targets = await resolveTargets(tx, userId, selector, { now: run.now, timeZone, max: ctx.max ?? BULK_MAX });
      if (ctx.expected) {
        const want = new Map(ctx.expected.map((e) => [e.id, e.version]));
        const same = want.size === targets.length && targets.every((t) => want.get(t.id) === t.version);
        if (!same) throw new ConflictError('Task', 'BULK_TARGETS_CHANGED');
      }
      const eventIds: string[] = [];
      const tasks: Task[] = [];
      for (const target of targets) {
        let task = target;
        const patch = patchFor(task, change, timeZone);
        if (Object.keys(patch).length > 0) {
          const r = await doUpdate(tx, userId, task, patch, run);
          task = r.task;
          eventIds.push(...r.eventIds);
        }
        const action = change.complete
          ? doComplete(tx, userId, task, run)
          : change.cancel
            ? doCancel(tx, userId, task, run)
            : change.reopen
              ? doReopen(tx, userId, task, run)
              : change.delete
                ? doSoftDelete(tx, userId, task, run)
                : null;
        if (action) {
          const r = await action;
          task = r.task;
          eventIds.push(...r.eventIds);
        }
        tasks.push(task);
      }
      await recordAudit(tx, {
        userId,
        actorType: run.actorType ?? (run.source === 'COMMAND' || run.source === 'VOICE' ? 'AGENT' : 'USER'),
        action: 'task.bulk_update',
        entityType: 'Task',
        agentRunId: run.agentRunId,
        proposalId: run.proposedActionId,
        requestId: run.requestId,
        metadata: { count: tasks.length, batchId: run.batchId, change: Object.keys(change) },
      });
      return { batchId: run.batchId, tasks, eventIds, replayed: false };
    },
    {
      store: (r) => ({ taskIds: r.tasks.map((t) => t.id), eventIds: r.eventIds, batchId: r.batchId }) as Prisma.InputJsonValue,
      replay: async (tx, s) => ({
        batchId: s.batchId as string,
        eventIds: s.eventIds as string[],
        tasks: await tx.task.findMany({ where: { id: { in: s.taskIds as string[] }, userId }, orderBy: { id: 'asc' } }),
        replayed: true,
      }),
    },
  );
}
