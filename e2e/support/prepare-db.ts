// e2e/support/prepare-db.ts — run by e2e/global-setup.ts through tsx, once
// before the Playwright suite (tsx, because the generated Prisma client is an
// ES module that Playwright's own TypeScript loader cannot require):
//   1. resets the public schema of the local E2E database and applies migrations
//   2. seeds one password user per spec (verified, America/New_York, briefing 06:30)
//   3. runs the REAL briefing jobs (scheduler tick + per-user generation) for
//      08:00 local today, in-process — the same code the Inngest functions call,
//      with the scripted model behind the lib/env.ts gate. Google is not
//      connected for any seeded user, so briefings use tasks only.
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { defaultJobDeps } from '@/inngest/daily-briefing';
import { hashPassword } from '@/lib/auth/password';
import { runBriefingGenerate, runSchedulerTick } from '@/lib/briefing/service';
import { createLogger } from '@/lib/observability/logger';
import { testPrisma as prisma } from '@/lib/test/factories';
import { isSafeTestDatabaseUrl } from '@/lib/test/global-db-setup';
import { addDays, atLocalTime, floatingDate, localDateOf } from '@/lib/time';
import { DATABASE_URL, PASSWORD, TIME_ZONE, USERS, serverEnv } from './config';

async function prepare(): Promise<void> {
  if (!isSafeTestDatabaseUrl(DATABASE_URL)) throw new Error('E2E needs a local test database URL (see docs/09 §2.2)');
  // The job code below reads the same environment as the server (scripted model gate included).
  const env = serverEnv();
  for (const k of ['E2E_SCRIPTED_MODEL', 'E2E_ALLOW_SCRIPTED_MODEL', 'TOKEN_ENCRYPTION_KEY'] as const) process.env[k] = env[k];
  if (process.env.DATABASE_URL !== DATABASE_URL) throw new Error('DATABASE_URL must be the E2E database');

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL }, stdio: ['ignore', 'ignore', 'inherit'] });

  const hash = await hashPassword(PASSWORD);
  const today = localDateOf(new Date(), TIME_ZONE);
  const day = (offset: number) => floatingDate(addDays(today, offset));

  const users: Record<keyof typeof USERS, string> = {} as Record<keyof typeof USERS, string>;
  for (const [key, email] of Object.entries(USERS) as [keyof typeof USERS, string][]) {
    const u = await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        password: hash,
        name: key[0].toUpperCase() + key.slice(1),
        preference: { create: { timeZone: TIME_ZONE, briefingHour: 6, briefingMinute: 30, workdayStart: '09:00', workdayEnd: '18:00', lunchEndsAt: '13:00' } },
      },
    });
    users[key] = u.id;
  }

  const tasks = (userId: string, rows: { title: string; due?: number; priority?: number; status?: 'INBOX' | 'TODO' }[]) =>
    prisma.task.createMany({
      data: rows.map((r) => ({ userId, title: r.title, status: r.status ?? 'TODO', priority: r.priority ?? 0, dueAt: r.due === undefined ? null : day(r.due), dueHasTime: false })),
    });

  await tasks(users.morning, [
    { title: 'Finish the quarterly report', due: 0, priority: 3 },
    { title: 'Renew passport', due: -2, priority: 2 },
    { title: 'Plan team offsite', due: 2 },
    { title: 'Book dentist', status: 'INBOX' },
  ]);
  await tasks(users.bulk, [
    { title: 'Bulk prep: slides', due: 1 },
    { title: 'Bulk prep: agenda', due: 1 },
    { title: 'Bulk prep: notes', due: 2 },
    { title: 'Water the plants', due: 0 },
  ]);
  await tasks(users.keys, [
    { title: 'Keyboard task one', due: 0 },
    { title: 'Keyboard task two', due: 0 },
    { title: 'Keyboard task three', due: 0 },
  ]);
  await tasks(users.alpha, [{ title: 'Alpha private task', due: 0 }]);
  await tasks(users.beta, [{ title: 'Beta own task', due: 0 }]);

  // The 8 AM run: one scheduler tick at 08:00 local, then each emitted event.
  const at8 = atLocalTime(today, '08:00', TIME_ZONE);
  const logger = createLogger({ job: 'e2e-briefing' }, () => {});
  const sent: { data: unknown }[] = [];
  const step = {
    run: async <T,>(_id: string, fn: () => Promise<T>): Promise<T> => {
      const out = await fn();
      return (out === undefined ? null : JSON.parse(JSON.stringify(out))) as T;
    },
    sendEvent: async (_id: string, events: { data: unknown }[]) => {
      sent.push(...events);
    },
  };
  const deps = { ...defaultJobDeps(), now: () => at8, logger };
  await runSchedulerTick(step, deps);
  if (sent.length !== Object.keys(USERS).length) throw new Error(`expected one briefing event per user, got ${sent.length}`);
  let i = 0;
  for (const event of sent) {
    const outcome = await runBriefingGenerate({ eventData: event.data, runId: `e2e-run-${++i}`, attempt: 0 }, step, deps);
    if (outcome.status === 'FAILED' || outcome.status === 'skipped') throw new Error(`briefing job failed: ${JSON.stringify(outcome)}`);
  }
  await prisma.$disconnect();
}

prepare().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`E2E database preparation failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
