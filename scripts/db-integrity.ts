// scripts/db-integrity.ts — post-migration integrity checks (docs/03 §7.3).
//
//   pnpm db:integrity                 # checks the database in DATABASE_URL
//   pnpm db:integrity -- --schema=x   # checks another schema (migration rehearsal)
//
// Read-only. Prints one JSON line per check and exits 1 if any check fails.
// Runs on plain Node (type stripping), so it uses only erasable TypeScript
// and no '@/…' imports. Output contains counts and ids only, never content.
import pg from 'pg';

export type CheckStatus = 'pass' | 'fail' | 'info' | 'skip';

export interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  details?: Record<string, unknown>;
}

interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

const PRISMA_TABLES = [
  'User', 'UserPreference', 'PasskeyCredential', 'WebAuthnChallenge', 'VerificationToken', 'RateLimitAttempt',
  'AuthEvent', 'AuditEvent', 'IntegrationAccount', 'Project', 'Task', 'TaskDependency', 'TaskEvent',
  'TaskOperation', 'Reminder', 'Memory', 'BriefingRun', 'DailyBriefing', 'AgentRun', 'ProposedAction', 'AgentAction',
];
const LEGACY_TABLES = [
  'users', 'accounts', 'sessions', 'verification_tokens', 'integration_accounts', 'tasks', 'memories',
  'daily_briefings', 'agent_runs', 'agent_actions', '_LegacyDailyBriefingDuplicate',
];

async function tableExists(db: Queryable, name: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1) AS ok`,
    [name],
  );
  return r.rows[0].ok;
}

async function count(db: Queryable, sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: string }>(sql, params);
  return Number(r.rows[0].n);
}

/** Zero-count checks: `sql` must return a single `n`. */
function zero(id: string, name: string, sql: string) {
  return async (db: Queryable): Promise<CheckResult> => {
    const n = await count(db, sql);
    return { id, name, status: n === 0 ? 'pass' : 'fail', details: { count: n } };
  };
}

const CHECKS: ((db: Queryable) => Promise<CheckResult>)[] = [
  async (db) => {
    if (!(await tableExists(db, '_prisma_migrations'))) return { id: 'I1', name: 'migrations applied', status: 'skip', details: { reason: 'no _prisma_migrations table in this schema' } };
    const r = await db.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`,
    );
    const bad = r.rows.filter((m) => !m.finished_at || m.rolled_back_at).map((m) => m.migration_name);
    return { id: 'I1', name: 'migrations applied', status: bad.length ? 'fail' : 'pass', details: { applied: r.rows.length, unfinishedOrRolledBack: bad } };
  },
  async (db) => {
    const counts: Record<string, number> = {};
    for (const t of [...PRISMA_TABLES, ...LEGACY_TABLES]) {
      if (await tableExists(db, t)) counts[t] = await count(db, `SELECT count(*) AS n FROM "${t}"`);
    }
    return { id: 'I2', name: 'row counts (compare with the pre-migration run)', status: 'info', details: counts };
  },
  async (db) => {
    const r = await db.query<{ status: string; n: string }>(`SELECT status::text AS status, count(*) AS n FROM "Task" GROUP BY 1 ORDER BY 1`);
    const deleted = await count(db, `SELECT count(*) AS n FROM "Task" WHERE "deletedAt" IS NOT NULL`);
    const doneWithoutCompletedAt = await count(db, `SELECT count(*) AS n FROM "Task" WHERE status = 'DONE' AND "completedAt" IS NULL`);
    return {
      id: 'I3',
      name: 'task status mapping',
      status: doneWithoutCompletedAt === 0 ? 'pass' : 'fail',
      details: { byStatus: Object.fromEntries(r.rows.map((x) => [x.status, Number(x.n)])), deleted, doneWithoutCompletedAt },
    };
  },
  async (db) => {
    if (!(await tableExists(db, '_pre_task'))) return { id: 'I4', name: 'notes/dueDate preserved', status: 'skip', details: { reason: 'no _pre_task snapshot' } };
    const n = await count(
      db,
      `SELECT count(*) AS n FROM "_pre_task" p LEFT JOIN "Task" t ON t.id = p.id
       WHERE t.id IS NULL OR t.description IS DISTINCT FROM p.notes OR t."dueAt" IS DISTINCT FROM p."dueDate"`,
    );
    return { id: 'I4', name: 'notes/dueDate preserved', status: n === 0 ? 'pass' : 'fail', details: { mismatches: n } };
  },
  zero(
    'I5',
    'every DailyBriefing has a matching BriefingRun',
    `SELECT count(*) AS n FROM "DailyBriefing" d LEFT JOIN "BriefingRun" r ON r.id = d."briefingRunId"
     WHERE r.id IS NULL OR r."userId" <> d."userId" OR r."localDate" <> d."localDate"`,
  ),
  zero(
    'I6',
    'AgentAction belongs to its AgentRun user',
    `SELECT count(*) AS n FROM "AgentAction" a LEFT JOIN "AgentRun" r ON r.id = a."agentRunId" WHERE r.id IS NULL OR r."userId" <> a."userId"`,
  ),
  async (db) => {
    const r = await db.query<{ indexname: string; tablename: string }>(
      `SELECT indexname, tablename FROM pg_indexes WHERE schemaname = current_schema() AND indexdef ILIKE '%hnsw%' ORDER BY 1`,
    );
    const ok = r.rows.some((x) => x.indexname === 'Memory_embedding_hnsw_idx' && x.tablename === 'Memory');
    return { id: 'I7', name: 'HNSW index on Memory', status: ok ? 'pass' : 'fail', details: { hnswIndexes: r.rows } };
  },
  async (db) => {
    const parts = {
      taskProjectCrossUser: await count(db, `SELECT count(*) AS n FROM "Task" t JOIN "Project" p ON p.id = t."projectId" WHERE p."userId" <> t."userId"`),
      taskParentCrossUser: await count(db, `SELECT count(*) AS n FROM "Task" t JOIN "Task" p ON p.id = t."parentId" WHERE p."userId" <> t."userId"`),
      dependencyCrossUser: await count(
        db,
        `SELECT count(*) AS n FROM "TaskDependency" d JOIN "Task" a ON a.id = d."taskId" JOIN "Task" b ON b.id = d."dependsOnId"
         WHERE a."userId" <> b."userId" OR a."userId" <> d."userId"`,
      ),
      reminderCrossUser: await count(db, `SELECT count(*) AS n FROM "Reminder" r JOIN "Task" t ON t.id = r."taskId" WHERE t."userId" <> r."userId"`),
      taskEventCrossUser: await count(db, `SELECT count(*) AS n FROM "TaskEvent" e JOIN "Task" t ON t.id = e."taskId" WHERE t."userId" <> e."userId"`),
      proposalCrossUser: await count(db, `SELECT count(*) AS n FROM "ProposedAction" p JOIN "AgentRun" r ON r.id = p."agentRunId" WHERE r."userId" <> p."userId"`),
    };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return { id: 'I8', name: 'no cross-user references', status: total === 0 ? 'pass' : 'fail', details: parts };
  },
  async (db) => {
    const n = await count(
      db,
      `SELECT count(*) AS n FROM "IntegrationAccount" WHERE "accessToken" NOT LIKE 'v1:%' OR ("refreshToken" IS NOT NULL AND "refreshToken" NOT LIKE 'v1:%')`,
    );
    // Becomes a hard check once M6b (token-format CHECK) lands.
    return { id: 'I9', name: 'integration tokens not yet sealed (must be 0 before M6b)', status: 'info', details: { plaintextRows: n } };
  },
  async (db) => {
    const n = await count(db, `SELECT count(*) AS n FROM "User" u LEFT JOIN "UserPreference" p ON p."userId" = u.id WHERE p."userId" IS NULL`);
    // Informational: lib/preferences creates the row lazily on first read.
    return { id: 'I10', name: 'users without a UserPreference row', status: 'info', details: { count: n } };
  },
  zero(
    'X1',
    'at most one open occurrence per recurrence series',
    `SELECT count(*) AS n FROM (
       SELECT "recurrenceSeriesId" FROM "Task"
       WHERE "recurrenceSeriesId" IS NOT NULL AND "deletedAt" IS NULL AND status IN ('INBOX','TODO','IN_PROGRESS')
       GROUP BY 1 HAVING count(*) > 1) s`,
  ),
  async (db) => {
    // Informational: rows inserted outside lib/tasks/repo (fixtures, manual SQL) have no history.
    const n = await count(db, `SELECT count(*) AS n FROM "Task" t WHERE NOT EXISTS (SELECT 1 FROM "TaskEvent" e WHERE e."taskId" = t.id)`);
    return { id: 'X2', name: 'tasks without any TaskEvent (undo/activity baseline)', status: 'info', details: { count: n } };
  },
];

export async function runIntegrityChecks(db: Queryable): Promise<{ ok: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  for (const check of CHECKS) results.push(await check(db));
  return { ok: results.every((r) => r.status !== 'fail'), results };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is not set\n');
    process.exit(2);
  }
  const schemaArg = process.argv.find((a) => a.startsWith('--schema='))?.slice('--schema='.length);
  if (schemaArg && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaArg)) {
    process.stderr.write('invalid --schema\n');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    if (schemaArg) await client.query(`SET search_path TO "${schemaArg}", public`);
    const { ok, results } = await runIntegrityChecks(client);
    for (const r of results) process.stdout.write(JSON.stringify(r) + '\n');
    process.stdout.write(JSON.stringify({ summary: ok ? 'pass' : 'fail', failed: results.filter((r) => r.status === 'fail').map((r) => r.id) }) + '\n');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await client.end();
  }
}

const invokedDirectly = typeof process.argv[1] === 'string' && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main().catch((e: unknown) => {
    process.stderr.write(`db-integrity failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  });
}
