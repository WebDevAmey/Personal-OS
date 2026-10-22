import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { floatingDate, parseZoned } from '@/lib/time';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  addDependency,
  applyBulkUpdate,
  archiveTask,
  cancelTask,
  completeTask,
  createReminder,
  createTask,
  getTask,
  listTaskHistory,
  listTasks,
  previewBulkUpdate,
  removeDependency,
  reopenTask,
  restoreTask,
  searchTasks,
  snoozeTask,
  softDeleteTask,
  undoBatch,
  undoEvent,
  updateTask,
} from './repo';

let a: User;
let b: User;

beforeAll(async () => {
  a = await makeUser({ label: 'repo_a' });
  b = await makeUser({ label: 'repo_b' });
});

afterAll(async () => {
  await deleteUsers(a, b);
});

const events = (taskId: string) => prisma.taskEvent.findMany({ where: { taskId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

describe('create / read / update', () => {
  it('creates a task with a CREATED event and the user time zone', async () => {
    const r = await createTask(a.id, { title: '  Write   the Q3 report ', dueAt: floatingDate('2026-10-22'), priority: 3, tags: ['Work', '#work', 'q3'] });
    expect(r.task).toMatchObject({ userId: a.id, title: 'Write the Q3 report', status: 'TODO', priority: 3, tags: ['work', 'q3'], timeZone: 'America/New_York', version: 1 });
    const evs = await events(r.task.id);
    expect(evs.map((e) => e.type)).toEqual(['CREATED']);
    expect(r.eventIds).toEqual([evs[0].id]);
  });

  it('puts a task without date or project into INBOX and moves it to TODO once it gets a date', async () => {
    const r = await createTask(a.id, { title: 'Capture me' });
    expect(r.task.status).toBe('INBOX');
    const u = await updateTask(a.id, r.task.id, 1, { dueAt: floatingDate('2026-10-30') });
    expect(u.task.status).toBe('TODO');
    expect(u.task.version).toBe(2);
  });

  it('records changed fields only, as before/after images', async () => {
    const r = await createTask(a.id, { title: 'Old title', priority: 1 });
    const u = await updateTask(a.id, r.task.id, 1, { title: 'New title', priority: 1 });
    const ev = await prisma.taskEvent.findUniqueOrThrow({ where: { id: u.eventIds[0] } });
    expect(ev.type).toBe('UPDATED');
    expect(ev.before).toEqual({ title: 'Old title' });
    expect(ev.after).toEqual({ title: 'New title' });
    expect(ev.taskVersion).toBe(2);
  });

  it('treats an unchanged update as a no-op (no event, no version bump)', async () => {
    const r = await createTask(a.id, { title: 'Same' });
    const u = await updateTask(a.id, r.task.id, 1, { title: 'Same' });
    expect(u.eventIds).toEqual([]);
    expect(u.task.version).toBe(1);
  });

  it('rejects a stale version with CONFLICT and writes nothing', async () => {
    const r = await createTask(a.id, { title: 'Versioned' });
    await updateTask(a.id, r.task.id, 1, { title: 'v2' });
    await expect(updateTask(a.id, r.task.id, 1, { title: 'stale' })).rejects.toBeInstanceOf(ConflictError);
    expect((await getTask(a.id, r.task.id)).title).toBe('v2');
    expect(await prisma.taskEvent.count({ where: { taskId: r.task.id } })).toBe(2);
  });

  it('validates fields', async () => {
    await expect(createTask(a.id, { title: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTask(a.id, { title: 'x', priority: 5 })).rejects.toThrow(/Priority/);
    await expect(createTask(a.id, { title: 'x', dueAt: new Date('2026-10-22T10:00:00Z'), dueHasTime: false })).rejects.toThrow(/date-only/);
    await expect(createTask(a.id, { title: 'x', recurrenceRule: 'FREQ=DAILY' })).rejects.toThrow(/needs a due date/);
    await expect(createTask(a.id, { title: 'x', estimateMinutes: 2 })).rejects.toThrow(/Estimate/);
    await expect(createTask(a.id, { title: 'x', timeZone: 'Nowhere/Land' })).rejects.toThrow(/time zone/);
  });

  it('only allows open statuses through update; transitions use complete/cancel/reopen', async () => {
    const r = await createTask(a.id, { title: 'Transitions', dueAt: floatingDate('2026-10-22') });
    await expect(updateTask(a.id, r.task.id, 1, { status: 'DONE' as never })).rejects.toThrow(/complete, cancel or reopen/);
    const p = await updateTask(a.id, r.task.id, 1, { status: 'IN_PROGRESS' });
    const ev = await prisma.taskEvent.findUniqueOrThrow({ where: { id: p.eventIds[0] } });
    expect(ev.type).toBe('STATUS_CHANGED');
    const c = await cancelTask(a.id, r.task.id);
    expect(c.task.status).toBe('CANCELLED');
    await expect(completeTask(a.id, r.task.id)).rejects.toThrow(/Reopen/);
    const o = await reopenTask(a.id, r.task.id);
    expect(o.task.status).toBe('TODO');
  });
});

describe('idempotency and concurrency', () => {
  it('double complete writes one COMPLETED event', async () => {
    const r = await createTask(a.id, { title: 'Complete twice' });
    const first = await completeTask(a.id, r.task.id);
    const second = await completeTask(a.id, r.task.id);
    expect(first.alreadyCompleted).toBe(false);
    expect(second.alreadyCompleted).toBe(true);
    expect(second.eventIds).toEqual([]);
    expect(await prisma.taskEvent.count({ where: { taskId: r.task.id, type: 'COMPLETED' } })).toBe(1);
  });

  it('concurrent completes of a recurring task produce one event and one next occurrence', async () => {
    const r = await createTask(a.id, { title: 'Water plants', dueAt: floatingDate('2026-10-21'), recurrenceRule: 'FREQ=DAILY' });
    const now = parseZoned('2026-10-21 12:00 America/New_York');
    const results = await Promise.all([completeTask(a.id, r.task.id, { now }), completeTask(a.id, r.task.id, { now }), completeTask(a.id, r.task.id, { now })]);
    expect(results.filter((x) => !x.alreadyCompleted)).toHaveLength(1);
    expect(await prisma.taskEvent.count({ where: { taskId: r.task.id, type: 'COMPLETED' } })).toBe(1);
    const series = await prisma.task.findMany({ where: { recurrenceSeriesId: r.task.recurrenceSeriesId! } });
    expect(series).toHaveLength(2);
    const next = series.find((t) => t.id !== r.task.id)!;
    expect(next.status).toBe('TODO');
    expect(next.dueAt?.toISOString()).toBe('2026-10-22T00:00:00.000Z');
  });

  it('two concurrent updates with the same version: exactly one CONFLICT', async () => {
    const r = await createTask(a.id, { title: 'Race' });
    const outcomes = await Promise.allSettled([
      updateTask(a.id, r.task.id, 1, { title: 'Writer one' }),
      updateTask(a.id, r.task.id, 1, { title: 'Writer two' }),
    ]);
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect((await getTask(a.id, r.task.id)).version).toBe(2);
  });

  it('replays a mutation with the same operationId instead of applying it twice', async () => {
    const operationId = randomUUID();
    const first = await createTask(a.id, { title: 'Once only' }, { operationId, source: 'COMMAND' });
    const again = await createTask(a.id, { title: 'Once only' }, { operationId, source: 'COMMAND' });
    expect(again.replayed).toBe(true);
    expect(again.task.id).toBe(first.task.id);
    expect(await prisma.task.count({ where: { userId: a.id, title: 'Once only' } })).toBe(1);

    const op2 = randomUUID();
    const [x, y] = await Promise.all([
      updateTask(a.id, first.task.id, 1, { title: 'Renamed once' }, { operationId: op2 }),
      updateTask(a.id, first.task.id, 1, { title: 'Renamed once' }, { operationId: op2 }),
    ]);
    expect([x.replayed, y.replayed].sort()).toEqual([false, true]);
    expect(await prisma.taskEvent.count({ where: { taskId: first.task.id, type: 'UPDATED' } })).toBe(1);
    const ev = await prisma.taskEvent.findFirstOrThrow({ where: { taskId: first.task.id, type: 'CREATED' } });
    expect(ev).toMatchObject({ source: 'COMMAND', actorType: 'AGENT', operationId });
  });

  it('refuses an operationId reused for a different kind of mutation', async () => {
    const operationId = randomUUID();
    const r = await createTask(a.id, { title: 'Op reuse' }, { operationId });
    await expect(completeTask(a.id, r.task.id, { operationId })).rejects.toMatchObject({ reason: 'OPERATION_ID_REUSED' });
  });

  it('scopes operationIds per user', async () => {
    const operationId = randomUUID();
    await createTask(a.id, { title: 'Mine' }, { operationId });
    const theirs = await createTask(b.id, { title: 'Theirs' }, { operationId });
    expect(theirs.replayed).toBe(false);
    expect(theirs.task.userId).toBe(b.id);
  });
});

describe('cross-user isolation (another user id ⇒ NotFound, nothing written)', () => {
  it('every task function rejects ids owned by another user', async () => {
    const victim = await createTask(a.id, { title: 'Private', dueAt: floatingDate('2026-10-22') });
    const other = await createTask(a.id, { title: 'Private 2' });
    const id = victim.task.id;
    const attempts: [string, () => Promise<unknown>][] = [
      ['getTask', () => getTask(b.id, id)],
      ['updateTask', () => updateTask(b.id, id, 1, { title: 'hijacked' })],
      ['completeTask', () => completeTask(b.id, id)],
      ['reopenTask', () => reopenTask(b.id, id)],
      ['cancelTask', () => cancelTask(b.id, id)],
      ['softDeleteTask', () => softDeleteTask(b.id, id)],
      ['restoreTask', () => restoreTask(b.id, id)],
      ['archiveTask', () => archiveTask(b.id, id)],
      ['snoozeTask', () => snoozeTask(b.id, id, new Date(Date.now() + 3600_000))],
      ['addDependency', () => addDependency(b.id, id, other.task.id)],
      ['removeDependency', () => removeDependency(b.id, id, other.task.id)],
      ['createReminder', () => createReminder(b.id, { taskId: id, remindAt: new Date(Date.now() + 3600_000) })],
      ['listTaskHistory', () => listTaskHistory(b.id, id)],
      ['undoEvent', () => undoEvent(b.id, victim.eventIds[0])],
      ['applyBulkUpdate', () => applyBulkUpdate(b.id, { ids: [id] }, { priority: 4 })],
      ['previewBulkUpdate', () => previewBulkUpdate(b.id, { ids: [id] }, { priority: 4 })],
      ['parent from another user', () => createTask(b.id, { title: 'child', parentId: id })],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toBeInstanceOf(NotFoundError);
    }
    const after = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ title: 'Private', version: 1, status: 'TODO', deletedAt: null, archivedAt: null, snoozedUntil: null });
    expect(await prisma.taskEvent.count({ where: { taskId: id } })).toBe(1);
    expect(await prisma.taskEvent.count({ where: { userId: b.id, taskId: id } })).toBe(0);
    expect(await prisma.reminder.count({ where: { taskId: id } })).toBe(0);
    expect(await prisma.taskDependency.count({ where: { taskId: id } })).toBe(0);
  });

  it('views and search never return another user’s tasks', async () => {
    await createTask(a.id, { title: 'Alpha secret invoice' });
    const page = await listTasks(b.id, { kind: 'all' }, { limit: 200 });
    expect(page.items.every((i) => i.task.userId === b.id)).toBe(true);
    const found = await searchTasks(b.id, { text: 'secret invoice' });
    expect(found.items).toHaveLength(0);
    await expect(listTasks(b.id, { kind: 'project', projectId: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('subtasks and dependencies', () => {
  it('keeps subtasks one level deep', async () => {
    const parent = await createTask(a.id, { title: 'Parent' });
    const child = await createTask(a.id, { title: 'Child', parentId: parent.task.id });
    expect(child.task.parentId).toBe(parent.task.id);
    await expect(createTask(a.id, { title: 'Grandchild', parentId: child.task.id })).rejects.toThrow(/one level/);
    await expect(updateTask(a.id, parent.task.id, 1, { parentId: parent.task.id })).rejects.toThrow(/own subtask/);
  });

  it('completing a parent warns about open subtasks unless asked to complete them', async () => {
    const parent = await createTask(a.id, { title: 'Ship it' });
    const s1 = await createTask(a.id, { title: 'Step 1', parentId: parent.task.id });
    const r = await completeTask(a.id, parent.task.id);
    expect(r.warnings).toContain('HAS_OPEN_SUBTASKS');
    expect((await getTask(a.id, s1.task.id)).status).toBe('TODO');

    const p2 = await createTask(a.id, { title: 'Ship it too' });
    const s2 = await createTask(a.id, { title: 'Step', parentId: p2.task.id });
    await completeTask(a.id, p2.task.id, { completeSubtasks: true });
    expect((await getTask(a.id, s2.task.id)).status).toBe('DONE');
  });

  it('rejects dependency cycles (direct and transitive) and self-dependency', async () => {
    const x = (await createTask(a.id, { title: 'X' })).task.id;
    const y = (await createTask(a.id, { title: 'Y' })).task.id;
    const z = (await createTask(a.id, { title: 'Z' })).task.id;
    await addDependency(a.id, x, y);
    await addDependency(a.id, y, z);
    await expect(addDependency(a.id, z, x)).rejects.toThrow(/cycle/);
    await expect(addDependency(a.id, y, x)).rejects.toThrow(/cycle/);
    await expect(addDependency(a.id, x, x)).rejects.toThrow(/itself/);
    const again = await addDependency(a.id, x, y);
    expect(again.eventIds).toEqual([]);
    expect(await prisma.taskDependency.count({ where: { userId: a.id, taskId: { in: [x, y, z] } } })).toBe(2);
  });

  it('serialises concurrent opposite edges so no cycle can form', async () => {
    const x = (await createTask(a.id, { title: 'P' })).task.id;
    const y = (await createTask(a.id, { title: 'Q' })).task.id;
    const out = await Promise.allSettled([addDependency(a.id, x, y), addDependency(a.id, y, x)]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.taskDependency.count({ where: { taskId: { in: [x, y] } } })).toBe(1);
  });

  it('warns when completing a blocked task and removes edges when a blocker is deleted', async () => {
    const blocker = (await createTask(a.id, { title: 'Blocker' })).task.id;
    const waiting = (await createTask(a.id, { title: 'Waiting' })).task.id;
    await addDependency(a.id, waiting, blocker);
    await softDeleteTask(a.id, blocker);
    expect(await prisma.taskDependency.count({ where: { taskId: waiting } })).toBe(0);
    const evs = await events(waiting);
    expect(evs.map((e) => e.type)).toEqual(['CREATED', 'DEPENDENCY_ADDED', 'DEPENDENCY_REMOVED']);
    await restoreTask(a.id, blocker);
    expect(await prisma.taskDependency.count({ where: { taskId: waiting } })).toBe(1);
    const r = await completeTask(a.id, waiting);
    expect(r.warnings).toContain('BLOCKED_BY_OPEN_DEPENDENCY');
  });
});

describe('soft delete, restore, archive, snooze', () => {
  it('soft-deletes (cancelling reminders) and restores (re-arming them)', async () => {
    const r = await createTask(a.id, { title: 'Dentist', dueAt: floatingDate('2030-01-10') });
    const rem = await createReminder(a.id, { taskId: r.task.id, remindAt: new Date('2030-01-09T15:00:00Z') });
    await softDeleteTask(a.id, r.task.id);
    await expect(getTask(a.id, r.task.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: rem.reminder.id } })).status).toBe('CANCELLED');
    const trash = await listTasks(a.id, { kind: 'trash' });
    expect(trash.items.map((i) => i.task.id)).toContain(r.task.id);
    await restoreTask(a.id, r.task.id);
    expect((await getTask(a.id, r.task.id)).deletedAt).toBeNull();
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: rem.reminder.id } })).status).toBe('PENDING');
  });

  it('archives and snoozes with events', async () => {
    const r = await createTask(a.id, { title: 'Later' });
    await expect(snoozeTask(a.id, r.task.id, new Date(Date.now() - 1000))).rejects.toThrow(/future/);
    const s = await snoozeTask(a.id, r.task.id, new Date(Date.now() + 3600_000));
    const ar = await archiveTask(a.id, r.task.id);
    expect(ar.task.archivedAt).not.toBeNull();
    expect((await events(r.task.id)).map((e) => e.type)).toEqual(['CREATED', 'SNOOZED', 'ARCHIVED']);
    expect(s.task.snoozedUntil).not.toBeNull();
  });
});

describe('undo', () => {
  it('undoes an update within the window and records UNDONE', async () => {
    const r = await createTask(a.id, { title: 'Before', dueAt: floatingDate('2026-10-22') });
    const u = await updateTask(a.id, r.task.id, 1, { title: 'After', dueAt: floatingDate('2026-10-23') });
    const undo = await undoEvent(a.id, u.eventIds[0]);
    const t = await getTask(a.id, r.task.id);
    expect(t.title).toBe('Before');
    expect(t.dueAt?.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    const ev = await prisma.taskEvent.findUniqueOrThrow({ where: { id: undo.eventIds[0] } });
    expect(ev).toMatchObject({ type: 'UNDONE', revertsEventId: u.eventIds[0] });
    await expect(undoEvent(a.id, u.eventIds[0])).rejects.toMatchObject({ reason: 'ALREADY_UNDONE' });
  });

  it('refuses undo after the window or after a later change', async () => {
    const r = await createTask(a.id, { title: 'Undo window' });
    const u = await updateTask(a.id, r.task.id, 1, { title: 'Changed' });
    await expect(undoEvent(a.id, u.eventIds[0], { now: new Date(Date.now() + 11 * 60_000) })).rejects.toThrow(/too old/);
    await updateTask(a.id, r.task.id, 2, { title: 'Changed again' });
    await expect(undoEvent(a.id, u.eventIds[0])).rejects.toMatchObject({ reason: 'CHANGED_SINCE' });
  });

  it('undoes create (soft delete), delete (restore) and complete (removes the rolled occurrence)', async () => {
    const c = await createTask(a.id, { title: 'Oops' });
    await undoEvent(a.id, c.eventIds[0]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.task.id } })).deletedAt).not.toBeNull();

    const d = await createTask(a.id, { title: 'Keep me' });
    const del = await softDeleteTask(a.id, d.task.id);
    await undoEvent(a.id, del.eventIds[0]);
    expect((await getTask(a.id, d.task.id)).deletedAt).toBeNull();

    const rec = await createTask(a.id, { title: 'Daily standup notes', dueAt: floatingDate('2026-10-21'), recurrenceRule: 'FREQ=DAILY' });
    const done = await completeTask(a.id, rec.task.id, { now: parseZoned('2026-10-21 10:00 America/New_York') });
    expect(done.nextOccurrence).not.toBeNull();
    await undoEvent(a.id, done.eventIds[0], { now: parseZoned('2026-10-21 10:05 America/New_York') });
    expect((await getTask(a.id, rec.task.id)).status).toBe('TODO');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: done.nextOccurrence!.id } })).deletedAt).not.toBeNull();
    const open = await prisma.task.count({ where: { recurrenceSeriesId: rec.task.recurrenceSeriesId!, deletedAt: null, status: { in: ['INBOX', 'TODO', 'IN_PROGRESS'] } } });
    expect(open).toBe(1);
  });

  it('undoes a dependency edge', async () => {
    const x = (await createTask(a.id, { title: 'Dx' })).task.id;
    const y = (await createTask(a.id, { title: 'Dy' })).task.id;
    const add = await addDependency(a.id, x, y);
    await undoEvent(a.id, add.eventIds[0]);
    expect(await prisma.taskDependency.count({ where: { taskId: x } })).toBe(0);
  });
});

describe('bulk', () => {
  it('previews without writing, then applies the same selector with one batch and one undo', async () => {
    const proj = await prisma.project.create({ data: { userId: a.id, name: `Bulk ${randomUUID().slice(0, 6)}` } });
    const ids: string[] = [];
    for (const day of ['2026-10-21', '2026-10-21', '2026-10-22']) {
      ids.push((await createTask(a.id, { title: `Bulk ${day}`, dueAt: floatingDate(day), projectId: proj.id })).task.id);
    }
    const selector = { filter: { projectId: proj.id } };
    const preview = await previewBulkUpdate(a.id, selector, { shiftDueDays: 5, addTags: ['moved'] });
    expect(preview.count).toBe(3);
    expect(preview.targets[0].after).toHaveProperty('dueAt');
    expect(await prisma.taskEvent.count({ where: { taskId: { in: ids }, type: { not: 'CREATED' } } })).toBe(0);
    expect((await prisma.task.findMany({ where: { id: { in: ids } } })).every((t) => t.version === 1)).toBe(true);

    const applied = await applyBulkUpdate(a.id, selector, { shiftDueDays: 5, addTags: ['moved'] }, { expected: preview.expected });
    expect(applied.tasks).toHaveLength(3);
    const dues = (await prisma.task.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } })).map((t) => t.dueAt!.toISOString().slice(0, 10));
    expect(dues.sort()).toEqual(['2026-10-26', '2026-10-26', '2026-10-27']);
    const batchEvents = await prisma.taskEvent.findMany({ where: { batchId: applied.batchId } });
    expect(batchEvents).toHaveLength(3);
    expect(await prisma.auditEvent.count({ where: { userId: a.id, action: 'task.bulk_update' } })).toBeGreaterThan(0);

    await undoBatch(a.id, applied.batchId);
    const restored = await prisma.task.findMany({ where: { id: { in: ids } } });
    expect(restored.map((t) => t.dueAt!.toISOString().slice(0, 10)).sort()).toEqual(['2026-10-21', '2026-10-21', '2026-10-22']);
    expect(restored.every((t) => !t.tags.includes('moved'))).toBe(true);
  });

  it('refuses to apply when the previewed targets changed (no writes)', async () => {
    const t1 = (await createTask(a.id, { title: 'Frozen 1' })).task.id;
    const t2 = (await createTask(a.id, { title: 'Frozen 2' })).task.id;
    const preview = await previewBulkUpdate(a.id, { ids: [t1, t2] }, { complete: true });
    await updateTask(a.id, t2, 1, { title: 'Edited meanwhile' });
    await expect(applyBulkUpdate(a.id, { ids: [t1, t2] }, { complete: true }, { expected: preview.expected })).rejects.toMatchObject({
      reason: 'BULK_TARGETS_CHANGED',
    });
    expect((await getTask(a.id, t1)).status).not.toBe('DONE');
  });

  it('bulk complete then undo restores every task', async () => {
    const t1 = (await createTask(a.id, { title: 'BC 1' })).task.id;
    const t2 = (await createTask(a.id, { title: 'BC 2' })).task.id;
    const applied = await applyBulkUpdate(a.id, { ids: [t1, t2] }, { complete: true, priority: 2 });
    expect(applied.tasks.every((t) => t.status === 'DONE' && t.priority === 2)).toBe(true);
    await undoBatch(a.id, applied.batchId);
    const back = await prisma.task.findMany({ where: { id: { in: [t1, t2] } } });
    expect(back.every((t) => t.status !== 'DONE' && t.priority === 0)).toBe(true);
  });
});
