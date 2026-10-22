// ARCH-002 / TASK-001: the post-20260825055921 migrations preserve data.
//
// Each scenario builds a scratch schema inside the test database, applies
// the init-era migrations, seeds old-shape rows, applies every later
// migration in order (each in its own transaction, as `migrate deploy`
// does) and asserts the mapping. The scratch schema is dropped afterwards.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertSafeTestDb } from '@/lib/test/factories';
import { runIntegrityChecks } from '@/scripts/db-integrity';

const DIR = path.join(process.cwd(), 'prisma', 'migrations');
const ALL = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const BASELINE = ['20260825055217_init', '20260825055921_add_memories_hnsw_index'];
const LATER = ALL.filter((m) => m > BASELINE[1]);

const sqlOf = (m: string) => readFileSync(path.join(DIR, m, 'migration.sql'), 'utf8');

let client: pg.Client;
let schema: string;

async function apply(migrations: string[]) {
  for (const m of migrations) {
    try {
      await client.query('BEGIN');
      await client.query(sqlOf(m));
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`${m}: ${(e as Error).message}`);
    }
  }
}

const rows = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await client.query<T>(sql, params)).rows;

const vec = (axis: number) => `[${Array.from({ length: 512 }, (_, i) => (i === axis ? 1 : 0)).join(',')}]`;

beforeEach(async () => {
  assertSafeTestDb();
  schema = `mig_${randomBytes(4).toString('hex')}`;
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  // Extensions live in public; types and tables are created in the scratch schema.
  await client.query(`SET search_path TO "${schema}", public`);
});

afterEach(async () => {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

async function seedLegacy() {
  await client.query(`
    INSERT INTO "User" (id, email, "googleId", "updatedAt") VALUES
      ('u1', 'u1@test.local', 'g-123', now()), ('u2', 'u2@test.local', NULL, now());

    INSERT INTO "Task" (id, "userId", title, notes, "dueDate", status, "completedAt", "createdAt", "updatedAt") VALUES
      ('t_open',     'u1', 'Open, date-only',  'some notes', '2026-08-28 00:00:00', 'open',      NULL,                  '2026-08-01', '2026-08-02'),
      ('t_timed',    'u1', 'Open, timed',      NULL,         '2026-08-28 15:30:00', 'open',      NULL,                  '2026-08-01', '2026-08-02'),
      ('t_done',     'u1', 'Completed',        NULL,         NULL,                  'completed', '2026-08-10 09:00:00', '2026-08-01', '2026-08-10'),
      ('t_del_open', 'u2', 'Deleted open',     'x',          NULL,                  'deleted',   NULL,                  '2026-08-01', '2026-08-15 12:00:00'),
      ('t_del_done', 'u2', 'Deleted done',     NULL,         NULL,                  'deleted',   '2026-08-11 09:00:00', '2026-08-01', '2026-08-16 12:00:00');

    INSERT INTO "Memory" (id, "userId", content, embedding) VALUES ('m1', 'u1', 'Rahul prefers email', '${vec(0)}');

    INSERT INTO "DailyBriefing" (id, "userId", "briefingDate", "attentionItems", "digestItems", "generatedAt") VALUES
      ('b_old', 'u1', '2026-08-20', '["old"]', '[]', '2026-08-20 06:00:00'),
      ('b_new', 'u1', '2026-08-20', '["new"]', '[]', '2026-08-20 07:00:00'),
      ('b_other', 'u1', '2026-08-21', '["a"]', '["d"]', '2026-08-21 06:00:00'),
      ('b_u2', 'u2', '2026-08-20', '[]', '[]', '2026-08-20 06:00:00');

    INSERT INTO "AgentRun" (id, "userId", input, "latencyMs") VALUES ('r1', 'u1', 'add a task', 1200);
    INSERT INTO "AgentAction" (id, "agentRunId", "toolName", "idempotencyKey", status) VALUES
      ('a_ok', 'r1', 'create_task', 'k1', 'success'), ('a_err', 'r1', 'create_task', 'k2', 'error');

    INSERT INTO "IntegrationAccount" (id, "userId", provider, "accessToken", "refreshToken", scopes) VALUES
      ('ia1', 'u1', 'google', 'plain-access', 'plain-refresh', 'gmail.readonly');

    INSERT INTO "PasskeyCredential" (id, "userId", "publicKey", transports, counter, "deviceType") VALUES
      ('pk1', 'u1', '\\x0102', ARRAY['internal'], 2147483000, 'singleDevice');

    INSERT INTO "WebAuthnChallenge" (id, "userId", challenge, "expiresAt") VALUES
      ('c_expired', 'u1', 'chal-old', now() - interval '1 hour'),
      ('c_live', 'u1', 'chal-live', now() + interval '5 minutes');

    INSERT INTO "AuthEvent" (id, type, "userId", email) VALUES ('ae1', 'LOGIN_SUCCESS', 'u1', 'u1@test.local');
  `);
}

describe('migrations after 20260825055921 (fresh-DB path)', () => {
  it('preserves and maps every legacy row', async () => {
    await apply(BASELINE);
    await seedLegacy();
    await apply(LATER);

    // Tasks: renames, status mapping, deletedAt, dueHasTime
    const tasks = await rows<{ id: string; status: string; description: string | null; dueAt: Date | null; dueHasTime: boolean; deletedAt: Date | null; completedAt: Date | null; version: number }>(
      `SELECT id, status::text, description, "dueAt", "dueHasTime", "deletedAt", "completedAt", version FROM "Task" ORDER BY id`,
    );
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    expect(tasks).toHaveLength(5);
    expect(byId.t_open).toMatchObject({ status: 'TODO', description: 'some notes', dueHasTime: false, deletedAt: null, version: 1 });
    expect(byId.t_open.dueAt?.toISOString()).toBe('2026-08-28T00:00:00.000Z');
    expect(byId.t_timed).toMatchObject({ status: 'TODO', dueHasTime: true });
    expect(byId.t_timed.dueAt?.toISOString()).toBe('2026-08-28T15:30:00.000Z');
    expect(byId.t_done).toMatchObject({ status: 'DONE', deletedAt: null });
    expect(byId.t_del_open).toMatchObject({ status: 'TODO', description: 'x' });
    expect(byId.t_del_open.deletedAt?.toISOString()).toBe('2026-08-15T12:00:00.000Z');
    expect(byId.t_del_done.status).toBe('DONE');
    expect(byId.t_del_done.deletedAt?.toISOString()).toBe('2026-08-16T12:00:00.000Z');
    const cols = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'Task'`,
      [schema],
    );
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(['notes']));
    expect(cols.map((c) => c.column_name)).not.toContain('_legacyStatus');

    // Baseline IMPORTED events
    const events = await rows<{ id: string; taskId: string; type: string; after: { legacyStatus: string; status: string } }>(
      `SELECT id, "taskId", type::text, after FROM "TaskEvent" ORDER BY "taskId"`,
    );
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.type === 'IMPORTED' && e.id === `mig_${e.taskId}`)).toBe(true);
    expect(events.find((e) => e.taskId === 't_del_done')?.after).toMatchObject({ legacyStatus: 'deleted', status: 'DONE' });

    // UserPreference backfill
    expect(await rows(`SELECT "userId", "timeZone" FROM "UserPreference" ORDER BY 1`)).toEqual([
      { userId: 'u1', timeZone: 'UTC' },
      { userId: 'u2', timeZone: 'UTC' },
    ]);

    // Briefings: date cast, newest-per-day kept, older duplicate moved, LEGACY runs
    const briefings = await rows<{ id: string; localDate: Date; schemaVersion: number; briefingRunId: string; attentionItems: string[] }>(
      `SELECT id, "localDate", "schemaVersion", "briefingRunId", "attentionItems" FROM "DailyBriefing" ORDER BY id`,
    );
    expect(briefings.map((b) => b.id)).toEqual(['b_new', 'b_other', 'b_u2']);
    expect(briefings.every((b) => b.schemaVersion === 1 && b.briefingRunId === `mig_${b.id}`)).toBe(true);
    expect(briefings[0].attentionItems).toEqual(['new']);
    const dup = await rows<{ id: string; attentionItems: string[] }>(`SELECT id, "attentionItems" FROM "_LegacyDailyBriefingDuplicate"`);
    expect(dup).toEqual([{ id: 'b_old', attentionItems: ['old'] }]);
    const runs = await rows<{ id: string; status: string; trigger: string; d: string }>(
      `SELECT id, status::text, trigger::text, to_char("localDate", 'YYYY-MM-DD') AS d FROM "BriefingRun" ORDER BY id`,
    );
    expect(runs).toEqual([
      { id: 'mig_b_new', status: 'SUCCEEDED', trigger: 'LEGACY', d: '2026-08-20' },
      { id: 'mig_b_other', status: 'SUCCEEDED', trigger: 'LEGACY', d: '2026-08-21' },
      { id: 'mig_b_u2', status: 'SUCCEEDED', trigger: 'LEGACY', d: '2026-08-20' },
    ]);

    // Command pipeline: legacy runs finished, actions get owner + enum status
    expect(await rows(`SELECT id, status::text, "latencyMs" FROM "AgentRun"`)).toEqual([{ id: 'r1', status: 'SUCCEEDED', latencyMs: 1200 }]);
    expect(await rows(`SELECT id, "userId", status::text FROM "AgentAction" ORDER BY id`)).toEqual([
      { id: 'a_err', userId: 'u1', status: 'ERROR' },
      { id: 'a_ok', userId: 'u1', status: 'SUCCESS' },
    ]);
    await client.query(`INSERT INTO "AgentRun" (id, "userId", input) VALUES ('r_new', 'u1', 'x')`);
    expect((await rows<{ status: string }>(`SELECT status::text FROM "AgentRun" WHERE id = 'r_new'`))[0].status).toBe('RUNNING');

    // Integration account backfill; tokens untouched (sealing is a separate script)
    expect(await rows(`SELECT "providerAccountId", "accountEmail", status::text, "accessToken" FROM "IntegrationAccount"`)).toEqual([
      { providerAccountId: 'g-123', accountEmail: 'u1@test.local', status: 'ACTIVE', accessToken: 'plain-access' },
    ]);

    // Auth hardening: counter widened with value kept, expired challenge dropped, events kept
    const pk = await rows<{ counter: string; data_type: string }>(
      `SELECT p.counter::text AS counter, c.data_type FROM "PasskeyCredential" p, information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = 'PasskeyCredential' AND c.column_name = 'counter'`,
      [schema],
    );
    expect(pk).toEqual([{ counter: '2147483000', data_type: 'bigint' }]);
    await client.query(`UPDATE "PasskeyCredential" SET counter = 4294967295`);
    expect(await rows(`SELECT id FROM "WebAuthnChallenge"`)).toEqual([{ id: 'c_live' }]);
    expect(await rows(`SELECT id, type::text FROM "AuthEvent"`)).toEqual([{ id: 'ae1', type: 'LOGIN_SUCCESS' }]);
    await client.query(`INSERT INTO "AuthEvent" (id, type) VALUES ('ae2', 'CSRF_BLOCKED'), ('ae3', 'PASSWORD_RESET_FAILED')`);

    // Memory: content + vector kept, defaults applied, HNSW index renamed
    expect(await rows(`SELECT id, content, source::text, "deletedAt", (embedding IS NOT NULL) AS e FROM "Memory"`)).toEqual([
      { id: 'm1', content: 'Rahul prefers email', source: 'COMMAND', deletedAt: null, e: true },
    ]);
    expect(await rows(`SELECT indexname, tablename FROM pg_indexes WHERE schemaname = $1 AND indexdef ILIKE '%hnsw%'`, [schema])).toEqual([
      { indexname: 'Memory_embedding_hnsw_idx', tablename: 'Memory' },
    ]);

    // Constraints added by the migrations hold
    await expect(client.query(`UPDATE "Task" SET priority = 9 WHERE id = 't_open'`)).rejects.toThrow(/Task_priority_check/);
    await expect(client.query(`UPDATE "UserPreference" SET "workdayStart" = '25:00' WHERE "userId" = 'u1'`)).rejects.toThrow(/UserPreference_time_check/);

    // The final shape matches the fully migrated public schema (same tables and columns)
    const shape = async (s: string) =>
      rows<{ t: string; c: string; dt: string }>(
        `SELECT table_name AS t, column_name AS c, udt_name AS dt FROM information_schema.columns
         WHERE table_schema = $1 AND table_name NOT IN ('_prisma_migrations', '_LegacyDailyBriefingDuplicate')
         ORDER BY 1, 2`,
        [s],
      );
    const mine = await shape(schema);
    const reference = (await shape('public')).filter((r) => mine.some((m) => m.t === r.t));
    expect(mine).toEqual(reference);

    // And the integrity script passes on the migrated data
    const { ok, results } = await runIntegrityChecks(client);
    expect(results.filter((r) => r.status === 'fail')).toEqual([]);
    expect(ok).toBe(true);
  });

  it('aborts M3 on an unexpected legacy Task.status instead of guessing', async () => {
    await apply(BASELINE);
    await client.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ('u1', 'u1@test.local', now())`);
    await client.query(`INSERT INTO "Task" (id, "userId", title, status, "updatedAt") VALUES ('t1', 'u1', 'x', 'archived', now())`);
    await expect(apply(LATER)).rejects.toThrow(/20261021090200_task_model_v2: .*unexpected values/);
    // Nothing of M3 was applied: the legacy column is intact.
    expect(await rows(`SELECT status FROM "Task"`)).toEqual([{ status: 'archived' }]);
  });

  it('aborts M4 on a malformed briefingDate', async () => {
    await apply(BASELINE);
    await client.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ('u1', 'u1@test.local', now())`);
    await client.query(`INSERT INTO "DailyBriefing" (id, "userId", "briefingDate", "attentionItems", "digestItems") VALUES ('b', 'u1', 'Aug 20', '[]', '[]')`);
    await expect(apply(LATER)).rejects.toThrow(/20261021090300_briefing_runs: .*YYYY-MM-DD/);
  });

  it('applies cleanly to an empty database (no duplicate table created)', async () => {
    await apply(BASELINE);
    await apply(LATER);
    expect(await rows(`SELECT to_regclass('"_LegacyDailyBriefingDuplicate"') AS t`)).toEqual([{ t: null }]);
    const { ok } = await runIntegrityChecks(client);
    expect(ok).toBe(true);
  });
});

describe('migrations after 20260825055921 (Drizzle-era HNSW collision path)', () => {
  it('creates the Memory HNSW index when the legacy name belongs to "memories"', async () => {
    // Drizzle-era database: "memories" already owns memories_embedding_idx,
    // so the init-era IF NOT EXISTS was a silent no-op for "Memory".
    await client.query(`CREATE TABLE memories (id text PRIMARY KEY, embedding vector(512))`);
    await client.query(`CREATE INDEX memories_embedding_idx ON memories USING hnsw (embedding vector_cosine_ops)`);
    await apply(BASELINE);
    const before = await rows(`SELECT indexname, tablename FROM pg_indexes WHERE schemaname = $1 AND indexdef ILIKE '%hnsw%' ORDER BY 1`, [schema]);
    expect(before).toEqual([{ indexname: 'memories_embedding_idx', tablename: 'memories' }]);

    await apply(LATER);
    const after = await rows(`SELECT indexname, tablename FROM pg_indexes WHERE schemaname = $1 AND indexdef ILIKE '%hnsw%' ORDER BY 1`, [schema]);
    expect(after).toHaveLength(2);
    expect(after).toEqual(
      expect.arrayContaining([
        { indexname: 'Memory_embedding_hnsw_idx', tablename: 'Memory' },
        { indexname: 'memories_embedding_idx', tablename: 'memories' },
      ]),
    );
  });
});
