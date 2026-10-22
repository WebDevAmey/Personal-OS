// BRIEF-008 — core of the 8 AM acceptance test (docs/00 §9, docs/09 §6.1):
// the briefing is prepared by the scheduler before the user opens the app,
// exactly once, grounded, and reading it makes no model call.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Task, User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeTask, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { floatingDate, parseZoned } from '@/lib/time';
import { runBriefingGenerate, runSchedulerTick, type JobDeps } from './service';
import { getTodayBriefing } from './today';
import { calEvent, email, fakeGoogle, fakeStep, mockModel, silentLogger } from './test-fixtures';
import type { BriefingEventPayload } from './events';

const TZ = 'America/New_York';
const at = (wall: string) => {
  const d = parseZoned(`2026-10-22 ${wall} ${TZ}`);
  vi.setSystemTime(d);
  return d;
};

let alex: User;
let early: User;
let t1: Task;
let t3: Task;

beforeAll(async () => {
  alex = await makeUser({ tz: TZ, label: 'alex', prefs: { briefingHour: 6, briefingMinute: 30, workdayStart: '09:00', lunchEndsAt: '13:00', workdayEnd: '18:00' } });
  early = await makeUser({ tz: TZ, label: 'eight', prefs: { briefingHour: 8, briefingMinute: 0 } });
  await prisma.integrationAccount.create({ data: { userId: alex.id, provider: 'google', accessToken: 'v1:fake', scopes: 'gmail.readonly calendar.readonly' } });
  t1 = await makeTask(alex.id, { title: 'Finish Q3 report', priority: 3, dueAt: floatingDate('2026-10-22') });
  await makeTask(alex.id, { title: 'Expense report', dueAt: floatingDate('2026-10-24') });
  t3 = await makeTask(alex.id, { title: 'Renew passport', priority: 2, dueAt: floatingDate('2026-10-19') });
  await makeTask(alex.id, { title: 'Book dentist', status: 'INBOX' });
});
afterEach(() => vi.useRealTimers());
afterAll(async () => deleteUsers(alex, early));

const google = () =>
  fakeGoogle({
    emails: [
      email('G1', 'Jordan Lee <jordan@talentco.example>', 'Next steps — Staff Engineer role', 'Could you share two times that work for a call this week?'),
      email('G2', 'Weekly Digest <news@letters.example>', 'This week in tech', 'Top stories…'),
    ],
    events: [
      calEvent('E1', 'Team standup', '2026-10-22T14:00:00.000Z', '2026-10-22T14:30:00.000Z'),
      calEvent('E2', '1:1 with Sam', '2026-10-22T19:00:00.000Z', '2026-10-22T20:00:00.000Z'),
    ],
  });

describe('The 8 AM loop: briefing prepared before the user arrives', () => {
  it('runs on the first tick at or after briefing time, once, and is ready at 08:00 with no model call on read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });

    // 06:15 tick: before 06:30 → no run.
    let step = fakeStep();
    await runSchedulerTick(step, { now: () => at('06:15'), logger: silentLogger });
    expect(step.sent.filter((e) => e.data.userId === alex.id)).toEqual([]);
    expect(await prisma.briefingRun.count({ where: { userId: alex.id } })).toBe(0);
    expect((await getTodayBriefing(alex.id, at('06:20'))).status).toBe('none');

    // 06:30 tick: one event for Alex's local date.
    step = fakeStep();
    await runSchedulerTick(step, { now: () => at('06:30'), logger: silentLogger });
    const events: BriefingEventPayload[] = step.sent.filter((e) => e.data.userId === alex.id);
    expect(events).toEqual([expect.objectContaining({ data: expect.objectContaining({ localDate: '2026-10-22', dedupeKey: `${alex.id}-2026-10-22` }) })]);
    expect((await getTodayBriefing(alex.id, at('06:30'))).status).toBe('preparing');

    // The per-user function processes it (the generator also tries to cite a thread it never saw).
    const model = mockModel([
      { kind: 'task', title: 'Finish Q3 report', reason: 'Due today, marked High', priority: 'high', isInferred: false, sources: [{ type: 'task', id: t1.id }] },
      { kind: 'task', title: 'Renew passport', reason: 'Was due Mon 19 Oct', priority: 'high', isInferred: false, sources: [{ type: 'task', id: t3.id }] },
      { kind: 'email', title: 'Reply to Jordan Lee about call times', reason: 'Jordan is likely waiting on two times for a call', priority: 'medium', isInferred: false, sources: [{ type: 'email', id: 'G1' }], suggestedCommand: 'Remind me about the recruiter email after lunch' },
      { kind: 'digest', title: '1 newsletter, nothing urgent', reason: 'Weekly Digest', priority: 'low', isInferred: false, sources: [{ type: 'email', id: 'G2' }] },
      { kind: 'email', title: 'Invoice overdue', reason: 'Pay now', priority: 'high', isInferred: false, sources: [{ type: 'email', id: 'G999' }] },
    ]);
    const deps: JobDeps = { now: () => new Date(), model: () => model, modelId: 'mock-model', logger: silentLogger, embed: null, google: google() };
    at('06:31');
    const outcome = await runBriefingGenerate({ eventData: events[0].data, runId: 'inngest-run-1', attempt: 0 }, fakeStep(), deps);
    expect(outcome).toMatchObject({ status: 'SUCCEEDED', failedSources: [] });

    // A later tick and a duplicate event change nothing.
    step = fakeStep();
    await runSchedulerTick(step, { now: () => at('06:45'), logger: silentLogger });
    expect(step.sent.filter((e) => e.data.userId === alex.id)).toEqual([]);
    expect(await runBriefingGenerate({ eventData: events[0].data, runId: 'inngest-run-2', attempt: 0 }, fakeStep(), deps)).toEqual({ status: 'skipped', reason: 'already_claimed' });

    const runs = await prisma.briefingRun.findMany({ where: { userId: alex.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'SUCCEEDED', trigger: 'SCHEDULED', attempts: 1 });
    expect((runs[0].metrics as { droppedUngrounded: number }).droppedUngrounded).toBe(1);

    // 08:00 — Alex opens Today.
    const callsBefore = model.doGenerateCalls.length;
    const today = await getTodayBriefing(alex.id, at('08:00'));
    expect(model.doGenerateCalls.length).toBe(callsBefore); // no model call while rendering
    expect(today.status).toBe('ready');
    expect(today.briefing).toMatchObject({ localDate: '2026-10-22', isStale: false, partialSources: [] });
    expect(new Date(today.briefing!.generatedAt).getTime()).toBe(parseZoned(`2026-10-22 06:31 ${TZ}`).getTime());

    const items = today.briefing!.items;
    const attention = items.filter((i) => i.kind !== 'digest');
    expect(attention.map((i) => [i.title, i.kind, i.sources[0].type, i.sources[0].id, i.isInferred])).toEqual([
      ['Finish Q3 report', 'task', 'task', t1.id, false],
      ['Renew passport', 'task', 'task', t3.id, false],
      ['Reply to Jordan Lee about call times', 'email', 'email', 'G1', true], // hedged → Inferred
    ]);
    // The newsletter is not a "Needs attention" item; nothing cites an unfetched id.
    expect(attention.some((i) => i.sources.some((s) => s.id === 'G2'))).toBe(false);
    const fetched = new Set([t1.id, t3.id, 'G1', 'G2', 'E1', 'E2']);
    for (const i of items) for (const s of i.sources) expect(fetched.has(s.id)).toBe(true);
    expect(attention[2].sources[0].label).toBe('Jordan Lee · Next steps — Staff Engineer role');
  });

  it('a user with briefingHour 08:00: no run at 07:59 local, run created at 08:00', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let step = fakeStep();
    await runSchedulerTick(step, { now: () => at('07:59'), logger: silentLogger });
    expect(step.sent.filter((e) => e.data.userId === early.id)).toEqual([]);
    expect(await prisma.briefingRun.count({ where: { userId: early.id } })).toBe(0);

    step = fakeStep();
    await runSchedulerTick(step, { now: () => at('08:00'), logger: silentLogger });
    expect(step.sent.filter((e) => e.data.userId === early.id)).toHaveLength(1);
    expect(await prisma.briefingRun.findMany({ where: { userId: early.id } })).toEqual([expect.objectContaining({ status: 'PENDING', localDate: floatingDate('2026-10-22') })]);
  });
});
