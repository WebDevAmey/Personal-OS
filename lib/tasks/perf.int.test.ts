// TASK-010: Today / Upcoming stay under 100 ms with 10k tasks for one user
// (plus another user's 10k rows as noise), and the queries use indexes.
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type Prisma, type User } from '@/lib/generated/prisma/client';
import type { Tx } from '@/lib/db/tx';
import { deleteUsers, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { listTasks } from './repo';

const N = 10_000;
const NOW = new Date('2026-03-08T15:00:00Z'); // a DST day in America/New_York
const BUDGET_MS = 100;

let P: User;
let noise: User;

function rowsFor(userId: string): Prisma.TaskCreateManyInput[] {
  const out: Prisma.TaskCreateManyInput[] = [];
  for (let i = 0; i < N; i++) {
    const r = (i * 7919) % 1000; // deterministic spread
    const dayOffset = (i % 121) - 60; // -60 … +60 days
    const timed = i % 3 === 0;
    const base = Date.UTC(2026, 2, 8) + dayOffset * 86_400_000;
    const dueAt = i % 10 === 0 ? null : new Date(timed ? base + ((i % 24) * 3_600_000) : base);
    const status = r < 600 ? (r < 100 ? 'INBOX' : r < 150 ? 'IN_PROGRESS' : 'TODO') : r < 900 ? 'DONE' : 'CANCELLED';
    out.push({
      userId,
      title: `Perf task ${i}`,
      status,
      priority: i % 5,
      dueAt,
      dueHasTime: dueAt ? timed : false,
      completedAt: status === 'DONE' ? new Date(base) : null,
      deletedAt: i % 50 === 0 ? new Date(base) : null,
    });
  }
  return out;
}

async function seed(userId: string) {
  const rows = rowsFor(userId);
  for (let i = 0; i < rows.length; i += 1000) await prisma.task.createMany({ data: rows.slice(i, i + 1000) });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function time(fn: () => Promise<unknown>, runs = 7): Promise<{ median: number; max: number }> {
  await fn(); // warm-up (connection, plan cache)
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    ts.push(performance.now() - t0);
  }
  return { median: Math.round(median(ts) * 10) / 10, max: Math.round(Math.max(...ts) * 10) / 10 };
}

beforeAll(async () => {
  P = await makeUser({ label: 'perf', tz: 'America/New_York' });
  noise = await makeUser({ label: 'perf_noise' });
  await seed(P.id);
  await seed(noise.id);
  await prisma.$executeRawUnsafe('ANALYZE "Task"');
}, 120_000);

afterAll(async () => deleteUsers(P, noise));

describe('TASK-010 view performance (10k tasks)', () => {
  it.each([
    ['today', { kind: 'today' as const }],
    ['upcoming', { kind: 'upcoming' as const }],
  ])('%s view: median under 100 ms', async (name, view) => {
    const page = await listTasks(P.id, view, { now: NOW, limit: 50 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.task.userId === P.id)).toBe(true);
    const t = await time(() => listTasks(P.id, view, { now: NOW, limit: 50 }));
    process.stdout.write(`[TASK-010] ${name}: median ${t.median} ms, max ${t.max} ms (n=${N}, limit 50)\n`);
    expect(t.median).toBeLessThan(BUDGET_MS);
  });

  it('Today and Upcoming queries use Task indexes (EXPLAIN ANALYZE)', async () => {
    const captured: { query: string; params: string }[] = [];
    const logging = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      log: [{ emit: 'event', level: 'query' }],
    });
    logging.$on('query', (e) => {
      if (/FROM "public"\."Task"|FROM "Task"/.test(e.query) && /SELECT/.test(e.query)) captured.push({ query: e.query, params: e.params });
    });
    const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await pgc.connect();
    try {
      for (const kind of ['today', 'upcoming'] as const) {
        captured.length = 0;
        await listTasks(P.id, { kind }, { now: NOW, limit: 50, tx: logging as unknown as Tx });
        expect(captured.length).toBeGreaterThan(0);
        for (const q of captured) {
          const params = JSON.parse(q.params) as unknown[];
          const plan = (await pgc.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${q.query}`, params)).rows
            .map((r) => r['QUERY PLAN'])
            .join('\n');
          const exec = /Execution Time: ([\d.]+) ms/.exec(plan)?.[1];
          const indexes = [...plan.matchAll(/(?:Index|Index Only|Bitmap Index) Scan (?:Backward )?(?:using|on) "?([\w]+)"?/g)].map((m) => m[1]);
          process.stdout.write(`[TASK-010] EXPLAIN ${kind}: execution ${exec} ms, indexes ${[...new Set(indexes)].join(', ')}\n`);
          expect(plan).not.toMatch(/Seq Scan on "?Task"?/);
          expect(indexes.some((i) => i.startsWith('Task_userId'))).toBe(true);
        }
      }
    } finally {
      await pgc.end();
      await logging.$disconnect();
    }
  });
});
