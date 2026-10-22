// Today read API, page-load enqueue and refresh (ADR-010, BRIEF-005..007, AC-305).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { floatingDate, parseZoned } from '@/lib/time';
import { createSessionCookie } from '@/lib/auth/session';
import { setBriefingEventSender, type BriefingEventPayload } from './events';
import { ensureTodayBriefingQueued, getTodayBriefing, requestBriefingRefresh } from './today';
import type { BriefingItem } from './types';

const users: User[] = [];
let sent: BriefingEventPayload[] = [];

beforeEach(() => {
  sent = [];
  setBriefingEventSender(async (events) => {
    sent.push(...events);
  });
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  setBriefingEventSender(null);
});
afterAll(async () => deleteUsers(...users));

async function user(): Promise<User> {
  const u = await makeUser({ tz: 'America/New_York', label: 'today' });
  users.push(u);
  return u;
}

const item: BriefingItem = {
  id: 'i1',
  kind: 'task',
  title: 'Finish Q3 report',
  reason: 'Due today, marked High',
  priority: 'high',
  isInferred: false,
  sources: [{ type: 'task', id: 'task_1', label: 'Finish Q3 report' }],
};

async function seedRun(userId: string, localDate: string, status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'RUNNING' | 'PENDING', opts: { generatedAt?: Date; items?: unknown[]; failedSources?: string[]; attempts?: number } = {}) {
  const run = await prisma.briefingRun.create({
    data: { userId, localDate: floatingDate(localDate), timeZone: 'America/New_York', status, trigger: 'SCHEDULED', failedSources: opts.failedSources ?? [], attempts: opts.attempts ?? 1 },
  });
  if (opts.generatedAt) {
    await prisma.dailyBriefing.create({ data: { userId, briefingRunId: run.id, localDate: floatingDate(localDate), items: (opts.items ?? [item]) as object[], generatedAt: opts.generatedAt } });
  }
  return run;
}

const at = (wall: string) => {
  const d = parseZoned(`${wall} America/New_York`);
  vi.setSystemTime(d);
  return d;
};

describe('getTodayBriefing', () => {
  it('none when there is no run and no earlier briefing', async () => {
    const u = await user();
    expect(await getTodayBriefing(u.id, at('2026-10-22 08:00'))).toEqual({ status: 'none' });
  });

  it('ready with items, partialSources and freshness for a PARTIAL run', async () => {
    const u = await user();
    const generatedAt = at('2026-10-22 06:31');
    await seedRun(u.id, '2026-10-22', 'PARTIAL', { generatedAt, failedSources: ['gmail'] });
    const res = await getTodayBriefing(u.id, at('2026-10-22 08:00'));
    expect(res).toEqual({
      status: 'ready',
      briefing: { localDate: '2026-10-22', generatedAt: generatedAt.toISOString(), isStale: false, partialSources: ['gmail'], items: [item] },
    });
  });

  it('is stale after 12 h (BRIEF-007)', async () => {
    const u = await user();
    await seedRun(u.id, '2026-10-22', 'SUCCEEDED', { generatedAt: at('2026-10-22 06:30') });
    expect((await getTodayBriefing(u.id, at('2026-10-22 18:30'))).briefing?.isStale).toBe(false);
    expect((await getTodayBriefing(u.id, at('2026-10-22 18:31'))).briefing?.isStale).toBe(true);
  });

  it('with only yesterday\'s briefing: status none, stale briefing included', async () => {
    const u = await user();
    await seedRun(u.id, '2026-10-21', 'SUCCEEDED', { generatedAt: at('2026-10-21 06:30') });
    const res = await getTodayBriefing(u.id, at('2026-10-22 06:00'));
    expect(res.status).toBe('none');
    expect(res.briefing).toMatchObject({ localDate: '2026-10-21', isStale: true });
  });

  it('preparing while PENDING/RUNNING; failed for FAILED', async () => {
    const u = await user();
    await seedRun(u.id, '2026-10-22', 'RUNNING');
    expect((await getTodayBriefing(u.id, at('2026-10-22 08:00'))).status).toBe('preparing');
    await prisma.briefingRun.updateMany({ where: { userId: u.id }, data: { status: 'FAILED' } });
    expect((await getTodayBriefing(u.id, at('2026-10-22 08:00'))).status).toBe('failed');
  });

  it('drops malformed stored items instead of rendering them', async () => {
    const u = await user();
    await seedRun(u.id, '2026-10-22', 'SUCCEEDED', { generatedAt: at('2026-10-22 06:30'), items: [item, { title: 'no sources', kind: 'task' }, 'legacy string'] });
    expect((await getTodayBriefing(u.id, at('2026-10-22 08:00'))).briefing?.items).toEqual([item]);
  });

  it('never returns another user\'s briefing', async () => {
    const a = await user();
    const b = await user();
    await seedRun(b.id, '2026-10-22', 'SUCCEEDED', { generatedAt: at('2026-10-22 06:30') });
    expect(await getTodayBriefing(a.id, at('2026-10-22 08:00'))).toEqual({ status: 'none' });
  });
});

describe('ensureTodayBriefingQueued (AC-305)', () => {
  it('two concurrent page loads create one run and send exactly one event', async () => {
    const u = await user();
    const now = at('2026-10-22 06:00');
    const results = await Promise.all([ensureTodayBriefingQueued(u.id, now), ensureTodayBriefingQueued(u.id, now), ensureTodayBriefingQueued(u.id, now)]);
    expect(results.filter((r) => r === 'queued')).toHaveLength(1);
    expect(results.filter((r) => r !== 'queued').every((r) => r === 'running')).toBe(true);
    expect(sent).toEqual([{ name: 'briefing/generate.requested', data: { userId: u.id, localDate: '2026-10-22', dedupeKey: `${u.id}-2026-10-22`, trigger: 'PAGE_LOAD' } }]);
    expect(await prisma.briefingRun.count({ where: { userId: u.id } })).toBe(1);
    expect((await getTodayBriefing(u.id, now)).status).toBe('preparing');
  });

  it('exists for a finished run; FAILED is retried at most every 10 min within the daily budget', async () => {
    const u = await user();
    at('2026-10-22 07:00');
    await seedRun(u.id, '2026-10-22', 'FAILED', { attempts: 1 });
    expect(await ensureTodayBriefingQueued(u.id, at('2026-10-22 07:05'))).toBe('exists');
    expect(await ensureTodayBriefingQueued(u.id, at('2026-10-22 07:11'))).toBe('queued');
    expect(sent.map((e) => e.data)).toEqual([expect.objectContaining({ trigger: 'RETRY', dedupeKey: `${u.id}-2026-10-22-r1` })]);
    expect(await ensureTodayBriefingQueued(u.id, at('2026-10-22 07:30'))).toBe('running');
    await prisma.briefingRun.updateMany({ where: { userId: u.id }, data: { status: 'FAILED', attempts: 4 } });
    expect(await ensureTodayBriefingQueued(u.id, at('2026-10-22 08:30'))).toBe('exists');
  });

  it('still reports queued when the event send fails (the scheduler re-emits stale PENDING runs)', async () => {
    const u = await user();
    setBriefingEventSender(async () => {
      throw new Error('inngest down');
    });
    expect(await ensureTodayBriefingQueued(u.id, at('2026-10-22 07:00'))).toBe('queued');
    expect((await prisma.briefingRun.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('PENDING');
  });
});

describe('requestBriefingRefresh', () => {
  it('refuses a fresh SUCCEEDED briefing (FR-311) and a pending/running one', async () => {
    const u = await user();
    await seedRun(u.id, '2026-10-22', 'SUCCEEDED', { generatedAt: at('2026-10-22 06:30') });
    expect(await requestBriefingRefresh(u.id, at('2026-10-22 09:00'))).toEqual({ outcome: 'fresh' });
    await prisma.briefingRun.updateMany({ where: { userId: u.id }, data: { status: 'RUNNING' } });
    expect(await requestBriefingRefresh(u.id, at('2026-10-22 09:00'))).toEqual({ outcome: 'running' });
    expect(sent).toEqual([]);
  });

  it('PARTIAL: once per 30 min, regenerates into the same row, no concurrent duplicate', async () => {
    const u = await user();
    at('2026-10-22 06:31');
    const run = await seedRun(u.id, '2026-10-22', 'PARTIAL', { generatedAt: new Date(), failedSources: ['gmail'] });
    expect(await requestBriefingRefresh(u.id, at('2026-10-22 06:50'))).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 11 * 60 });
    const now = at('2026-10-22 07:02');
    const [r1, r2] = await Promise.all([requestBriefingRefresh(u.id, now), requestBriefingRefresh(u.id, now)]);
    expect([r1.outcome, r2.outcome].sort()).toEqual(['queued', 'running']);
    expect(sent).toHaveLength(1);
    expect(sent[0].data).toMatchObject({ trigger: 'RETRY', dedupeKey: `${u.id}-2026-10-22-r1` });
    const rows = await prisma.briefingRun.findMany({ where: { userId: u.id } });
    expect(rows).toEqual([expect.objectContaining({ id: run.id, status: 'PENDING', trigger: 'RETRY' })]);
  });

  it('stops after the daily attempt budget', async () => {
    const u = await user();
    at('2026-10-22 06:31');
    await seedRun(u.id, '2026-10-22', 'FAILED', { attempts: 4 });
    expect(await requestBriefingRefresh(u.id, at('2026-10-22 09:00'))).toEqual({ outcome: 'exhausted' });
  });
});

describe('HTTP routes', () => {
  const origin = 'http://localhost:3000';
  async function cookieFor(u: User): Promise<string> {
    return (await createSessionCookie({ id: u.id, sessionVersion: u.sessionVersion })).split(';')[0];
  }

  it('GET /api/briefing/today requires a session and returns the read-API shape', async () => {
    vi.useRealTimers();
    const { GET } = await import('@/app/api/briefing/today/route');
    expect((await GET(new Request(`${origin}/api/briefing/today`))).status).toBe(401);
    const u = await user();
    const res = await GET(new Request(`${origin}/api/briefing/today`, { headers: { cookie: await cookieFor(u) } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ status: 'none' });
  });

  it('POST /api/briefing/today/refresh enforces CSRF and auth, then queues once', async () => {
    vi.useRealTimers();
    const { POST } = await import('@/app/api/briefing/today/refresh/route');
    const u = await user();
    const cookie = await cookieFor(u);
    const cross = await POST(new Request(`${origin}/api/briefing/today/refresh`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', cookie }, body: '{}' }));
    expect(cross.status).toBe(403);
    const anon = await POST(new Request(`${origin}/api/briefing/today/refresh`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' }));
    expect(anon.status).toBe(401);
    const ok = await POST(new Request(`${origin}/api/briefing/today/refresh`, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie }, body: '{}' }));
    expect(ok.status).toBe(202);
    const again = await POST(new Request(`${origin}/api/briefing/today/refresh`, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie }, body: '{}' }));
    expect(again.status).toBe(409);
    expect(sent.filter((e) => e.data.userId === u.id)).toHaveLength(1);
  });
});
