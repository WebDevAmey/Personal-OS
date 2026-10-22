import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { floatingDate, parseZoned } from '@/lib/time';
import {
  cancelReminder,
  claimReminderForDispatch,
  completeTask,
  createReminder,
  createTask,
  findSimilarTasks,
  listReminders,
  listTasks,
  markReminderSent,
  rescheduleReminder,
  searchTasks,
  searchTasksByQuery,
  snoozeTask,
  undoEvent,
} from './repo';

const NY = 'America/New_York';
let u: User;
let other: User;

beforeAll(async () => {
  u = await makeUser({ label: 'views', tz: NY });
  other = await makeUser({ label: 'views_other', tz: NY });
});
afterAll(async () => deleteUsers(u, other));

describe('Today / Overdue / Upcoming in the user time zone', () => {
  // Wed 21 Oct 2026, 08:05 New York (docs/00 §5.4.3)
  const now = parseZoned('2026-10-21 08:05 America/New_York');
  let ids: Record<string, string>;

  beforeAll(async () => {
    const mk = async (title: string, extra: Parameters<typeof createTask>[1] = { title }) => (await createTask(u.id, { ...extra, title })).task.id;
    ids = {
      overdueDate: await mk('Overdue date-only', { title: '', dueAt: floatingDate('2026-10-20'), priority: 1 }),
      overdueTimed: await mk('Overdue timed', { title: '', dueAt: parseZoned('2026-10-20 23:30 America/New_York'), dueHasTime: true }),
      todayDate: await mk('Today date-only', { title: '', dueAt: floatingDate('2026-10-21'), priority: 3 }),
      // 23:30 NY on the 21st is already the 22nd in UTC: still "today" locally.
      todayLateTimed: await mk('Today late timed', { title: '', dueAt: parseZoned('2026-10-21 23:30 America/New_York'), dueHasTime: true, priority: 3 }),
      startsToday: await mk('Starts today', { title: '', startAt: parseZoned('2026-10-21 14:00 America/New_York') }),
      tomorrow: await mk('Tomorrow', { title: '', dueAt: floatingDate('2026-10-22') }),
      inTenDays: await mk('In ten days', { title: '', dueAt: floatingDate('2026-10-31') }),
      later: await mk('Much later', { title: '', dueAt: floatingDate('2026-12-25') }),
      snoozed: await mk('Snoozed today', { title: '', dueAt: floatingDate('2026-10-21') }),
      done: await mk('Done today', { title: '', dueAt: floatingDate('2026-10-21') }),
    };
    await snoozeTask(u.id, ids.snoozed, parseZoned('2026-10-21 12:00 America/New_York'), { now });
    await completeTask(u.id, ids.done, { now });
    await createTask(other.id, { title: 'Other user today', dueAt: floatingDate('2026-10-21') });
  });

  it('Today = overdue group first, then today by priority; excludes snoozed, done and other users', async () => {
    const page = await listTasks(u.id, { kind: 'today' }, { now, timeZone: NY });
    const byGroup = (g: string) => page.items.filter((i) => i.group === g).map((i) => i.task.id);
    expect(byGroup('overdue').sort()).toEqual([ids.overdueDate, ids.overdueTimed].sort());
    expect(page.items.slice(0, 2).every((i) => i.group === 'overdue')).toBe(true);
    expect(byGroup('today')).toEqual([ids.todayLateTimed, ids.todayDate, ids.startsToday]);
    expect(page.items.map((i) => i.task.id)).not.toContain(ids.snoozed);
    expect(page.items.map((i) => i.task.id)).not.toContain(ids.done);
  });

  it('shows a snoozed task again once the snooze has passed', async () => {
    const afterSnooze = parseZoned('2026-10-21 12:30 America/New_York');
    const page = await listTasks(u.id, { kind: 'today' }, { now: afterSnooze, timeZone: NY });
    expect(page.items.map((i) => i.task.id)).toContain(ids.snoozed);
  });

  it('Overdue = due before today', async () => {
    const page = await listTasks(u.id, { kind: 'overdue' }, { now, timeZone: NY });
    expect(page.items.map((i) => i.task.id)).toEqual([ids.overdueDate, ids.overdueTimed]);
    expect(page.items).toHaveLength(2);
  });

  it('Upcoming groups the next 14 days by local date, then "later"', async () => {
    const page = await listTasks(u.id, { kind: 'upcoming' }, { now, timeZone: NY });
    const groups = Object.fromEntries(page.items.map((i) => [i.task.id, i.group]));
    expect(groups[ids.tomorrow]).toBe('2026-10-22');
    expect(groups[ids.inTenDays]).toBe('2026-10-31');
    expect(groups[ids.later]).toBe('later');
    expect(groups[ids.todayDate]).toBeUndefined();
  });

  it('Completed lists DONE newest first, grouped by local completion date', async () => {
    const page = await listTasks(u.id, { kind: 'completed' }, { now, timeZone: NY });
    expect(page.items[0]).toMatchObject({ group: '2026-10-21' });
    expect(page.items.map((i) => i.task.id)).toContain(ids.done);
  });

  it('respects the view time zone on DST change days (America/New_York 2026-11-01 has 25 hours)', async () => {
    const lateOnFallBack = (await createTask(u.id, { title: 'Fall-back late', dueAt: parseZoned('2026-11-01 23:30 America/New_York'), dueHasTime: true })).task.id;
    const earlyNextDay = (await createTask(u.id, { title: 'Next day early', dueAt: parseZoned('2026-11-02 00:15 America/New_York'), dueHasTime: true })).task.id;
    const onDay = parseZoned('2026-11-01 08:00 America/New_York');
    const page = await listTasks(u.id, { kind: 'today' }, { now: onDay, timeZone: NY, filter: { hasDue: true } });
    const todayIds = page.items.filter((i) => i.group === 'today').map((i) => i.task.id);
    expect(todayIds).toContain(lateOnFallBack);
    expect(todayIds).not.toContain(earlyNextDay);

    const springLate = (await createTask(u.id, { title: 'Spring late', dueAt: parseZoned('2026-03-08 23:30 America/New_York'), dueHasTime: true })).task.id;
    const spring = await listTasks(u.id, { kind: 'today' }, { now: parseZoned('2026-03-08 09:00 America/New_York'), timeZone: NY });
    expect(spring.items.filter((i) => i.group === 'today').map((i) => i.task.id)).toContain(springLate);
  });
});

describe('cursor pagination', () => {
  it('walks a view in pages without gaps or repeats, across segments', async () => {
    const pager = await makeUser({ label: 'pager', tz: NY });
    try {
      const now = parseZoned('2026-10-21 09:00 America/New_York');
      for (let i = 0; i < 7; i++) await createTask(pager.id, { title: `Overdue ${i}`, dueAt: floatingDate('2026-10-1' + i), priority: i % 3 });
      for (let i = 0; i < 8; i++) await createTask(pager.id, { title: `Today ${i}`, dueAt: floatingDate('2026-10-21'), priority: i % 2 });
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await listTasks(pager.id, { kind: 'today' }, { now, timeZone: NY, limit: 4, cursor });
        seen.push(...page.items.map((i) => i.task.id));
        cursor = page.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(4);
      expect(seen).toHaveLength(15);
      expect(new Set(seen).size).toBe(15);
      const full = await listTasks(pager.id, { kind: 'today' }, { now, timeZone: NY, limit: 200 });
      expect(seen).toEqual(full.items.map((i) => i.task.id));

      const byTitle: string[] = [];
      cursor = null;
      do {
        const page = await listTasks(pager.id, { kind: 'all' }, { sort: 'due', limit: 6, cursor });
        byTitle.push(...page.items.map((i) => i.task.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(byTitle).toEqual((await listTasks(pager.id, { kind: 'all' }, { sort: 'due', limit: 200 })).items.map((i) => i.task.id));
    } finally {
      await deleteUsers(pager);
    }
  });

  it('rejects a forged cursor', async () => {
    await expect(listTasks(u.id, { kind: 'all' }, { cursor: 'not-a-cursor' })).rejects.toThrow(/cursor/);
  });
});

describe('filters and search', () => {
  it('filters by tags, priority, status and due range', async () => {
    const tagged = (await createTask(u.id, { title: 'Tagged urgent', tags: ['finance'], priority: 4, dueAt: floatingDate('2026-11-05') })).task.id;
    const page = await listTasks(u.id, { kind: 'all' }, { filter: { tags: ['finance'], minPriority: 4, status: ['TODO'], dueFrom: floatingDate('2026-11-01'), dueTo: floatingDate('2026-11-10') } });
    expect(page.items.map((i) => i.task.id)).toEqual([tagged]);
  });

  it('ranks full-text matches (prefix, title + description + tags) and supports query syntax', async () => {
    const inv = (await createTask(u.id, { title: 'Pay Acme invoices', description: 'quarterly', dueAt: floatingDate('2026-10-23') })).task.id;
    const desc = (await createTask(u.id, { title: 'Email accountant', description: 'about the invoice numbers' })).task.id;
    const tag = (await createTask(u.id, { title: 'Misc', tags: ['invoice'] })).task.id;
    const prefix = await searchTasks(u.id, { text: 'invoic' });
    expect(prefix.items.map((i) => i.task.id)).toEqual(expect.arrayContaining([inv, desc, tag]));
    const res = await searchTasks(u.id, { text: 'invoice' });
    const found = res.items.map((i) => i.task.id);
    expect(found).toEqual(expect.arrayContaining([inv, desc, tag]));
    expect(found[0]).toBe(tag); // exact tag match boosts rank
    const q = await searchTasksByQuery(u.id, 'invoic due:2026-10-23', { timeZone: NY });
    expect(q.items.map((i) => i.task.id)).toEqual([inv]);
  });

  it('hints at similar open titles (FR-214) without blocking creation', async () => {
    await createTask(u.id, { title: 'Finish the Q3 report' });
    const r = await createTask(u.id, { title: 'finish Q3 report!' });
    expect(r.similar.map((s) => s.title)).toContain('Finish the Q3 report');
    expect(r.similar[0].score).toBeGreaterThanOrEqual(0.8);
    expect(await findSimilarTasks(other.id, 'Finish the Q3 report')).toEqual([]);
  });
});

describe('recurrence through the repository (DST)', () => {
  it('completing a timed daily task before spring-forward generates 09:00 EDT next', async () => {
    const r = await createTask(u.id, { title: 'Morning meds', dueAt: parseZoned('2026-03-07 09:00 America/New_York'), dueHasTime: true, recurrenceRule: 'FREQ=DAILY' });
    expect(r.task.recurrenceRule).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=0');
    const done = await completeTask(u.id, r.task.id, { now: parseZoned('2026-03-07 09:30 America/New_York') });
    expect(done.nextOccurrence?.dueAt?.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    const done2 = await completeTask(u.id, done.nextOccurrence!.id, { now: parseZoned('2026-03-08 09:30 America/New_York') });
    expect(done2.nextOccurrence?.dueAt?.toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });

  it('completing across fall-back keeps the wall time (09:00 EST)', async () => {
    const r = await createTask(u.id, { title: 'Weekly review', dueAt: parseZoned('2026-10-25 09:00 America/New_York'), dueHasTime: true, recurrenceRule: 'FREQ=WEEKLY' });
    const done = await completeTask(u.id, r.task.id, { now: parseZoned('2026-10-25 10:00 America/New_York') });
    expect(done.nextOccurrence?.dueAt?.toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('rolls missed occurrences forward and keeps one open instance per series', async () => {
    const r = await createTask(u.id, { title: 'Daily journal', dueAt: floatingDate('2026-10-01'), recurrenceRule: 'FREQ=DAILY' });
    const done = await completeTask(u.id, r.task.id, { now: parseZoned('2026-10-21 08:00 America/New_York') });
    expect(done.nextOccurrence?.dueAt?.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(await prisma.task.count({ where: { recurrenceSeriesId: r.task.recurrenceSeriesId!, status: 'TODO', deletedAt: null } })).toBe(1);
  });
});

describe('reminders', () => {
  it('creates, reschedules, dispatches once, and cancels; scoped to the owner', async () => {
    const t = (await createTask(u.id, { title: 'Reply to Jordan', dueAt: floatingDate('2030-10-21') })).task;
    const r = await createReminder(u.id, { taskId: t.id, remindAt: new Date('2030-10-21T17:00:00Z') });
    expect(r.reminder).toMatchObject({ title: 'Reply to Jordan', status: 'PENDING', version: 1 });
    const moved = await rescheduleReminder(u.id, r.reminder.id, new Date('2030-10-21T18:00:00Z'), { expectedVersion: 1 });
    expect(moved.reminder.version).toBe(2);
    expect(await claimReminderForDispatch(u.id, r.reminder.id, 1)).toBeNull(); // stale version
    expect(await claimReminderForDispatch(other.id, r.reminder.id, 2)).toBeNull(); // other user
    expect(await claimReminderForDispatch(u.id, r.reminder.id, 2)).not.toBeNull();
    expect(await markReminderSent(u.id, r.reminder.id, 2)).toBe(true);
    expect(await markReminderSent(u.id, r.reminder.id, 2)).toBe(false);
    await expect(cancelReminder(other.id, r.reminder.id)).rejects.toThrow(/not found/);
    await expect(rescheduleReminder(other.id, r.reminder.id, new Date())).rejects.toThrow(/not found/);
    expect(await listReminders(other.id)).toEqual([]);
    const types = (await prisma.taskEvent.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' } })).map((e) => e.type);
    expect(types).toEqual(['CREATED', 'REMINDER_SET', 'REMINDER_SET']);
  });

  it('undo of a new reminder cancels it', async () => {
    const t = (await createTask(u.id, { title: 'Call mum' })).task;
    const r = await createReminder(u.id, { taskId: t.id, remindAt: new Date(Date.now() + 86_400_000) });
    await undoEvent(u.id, r.eventIds[0]);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: r.reminder.id } })).status).toBe('CANCELLED');
  });
});
