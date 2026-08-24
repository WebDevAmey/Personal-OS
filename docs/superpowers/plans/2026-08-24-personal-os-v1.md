# Personal OS V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the V1 vertical slice from `docs/superpowers/specs/2026-08-24-personal-os-v1-design.md`: a multi-user web app where a Today screen shows a generated daily briefing and a global command bar (text or voice) lets the user create/reschedule tasks and save/recall memories through a typed, auditable AI tool-calling layer backed by Gmail, Google Calendar, and Tavily.

**Architecture:** Single Next.js 15 App Router app on Vercel. Neon Postgres (+pgvector) via Drizzle ORM. Claude (Anthropic) via the Vercel AI SDK drives a single-agent tool-calling loop over a Zod-typed tool registry — the model never touches the database directly. Gmail/Calendar/Web sit behind narrow capability interfaces. Inngest runs the scheduled daily-briefing job. Upstash Redis rate-limits AI and integration calls. Auth.js (Google-only) provides both login and the OAuth tokens integrations need.

**Tech Stack:** Next.js 15, React 19, TypeScript 5 (strict), Tailwind CSS, shadcn/ui + beUI + Watermelon UI + VengeanceUI (all via shadcn registry), Drizzle ORM + drizzle-kit, `@neondatabase/serverless`, Auth.js v5, `ai` + `@ai-sdk/anthropic`, `googleapis` (Gmail + Calendar), Tavily REST API, Voyage AI REST API (`voyage-3-lite`, 512-dim embeddings), Inngest, `@upstash/redis` + `@upstash/ratelimit`, Vitest, pnpm.

## Global Constraints

- Every DB query is scoped by `user_id` at the query-builder level — no query touches a row without a `user_id` filter (spec §10.1).
- The AI model touches user data **only** through the typed tool registry — no tool, no mutation (spec §6).
- Every tool call carries an idempotency key; retries/double-submits must not double-mutate data (spec §11).
- Integration adapters are tested against recorded fixtures, never live Gmail/Calendar/Tavily accounts, so CI has no external dependency (spec §13).
- Tests assert actual mutations/values (e.g. `expect(task.dueDate).toEqual(fridayDate)`), never just "no error thrown" (spec §13).
- V1 does not implement: calendar writes, `projects`/`entities`/`relationships`/`learning_*` tables, a standalone Inbox/Search page, or multi-agent routing (spec §2).
- Package manager: pnpm. Node 20+.

---

## Task 1: Project Scaffold & Tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.env.example`, `.gitignore`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `vitest.config.ts`, `lib/test/setup.ts`

**Interfaces:**
- Produces: a running Next.js dev server and a Vitest runner other tasks' tests execute under.

- [ ] **Step 1: Scaffold the Next.js app**

```bash
pnpm dlx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint
```

Answer prompts to keep it in the current directory (`.`).

- [ ] **Step 2: Install core dependencies**

```bash
pnpm add drizzle-orm @neondatabase/serverless zod ai @ai-sdk/anthropic googleapis @upstash/redis @upstash/ratelimit inngest next-auth@beta
pnpm add -D drizzle-kit vitest @vitejs/plugin-react vite-tsconfig-paths dotenv
```

- [ ] **Step 3: Initialize shadcn/ui and pull in the supplementary registries**

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button input dialog command card badge separator
pnpm dlx shadcn@latest add "https://beui.dev/r/command-palette.json"
pnpm dlx shadcn@latest add "https://ui.watermelon.sh/r/stat-card.json"
pnpm dlx shadcn@latest add "https://www.vengeanceui.com/r/animated-tooltip.json"
```

If a registry URL differs from the above at implementation time (registries move), find the current JSON manifest URL on the library's site and substitute it — the install mechanism (`shadcn add <url>`) doesn't change. Note the local path the CLI writes the VengeanceUI component to (typically `components/ui/animated-tooltip.tsx`) — Task 12 imports it from there.

- [ ] **Step 4: Configure Vitest**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./lib/test/setup.ts'],
  },
});
```

```ts
// lib/test/setup.ts
import { config } from 'dotenv';
config({ path: '.env.test' });
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 5: Verify the scaffold**

```bash
pnpm build
```

Expected: build completes with no errors, producing `.next/`.

```bash
pnpm test
```

Expected: `No test files found` (passes — no tests written yet).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with shadcn, vitest, core deps"
```

---

## Task 2: Database Schema & Migrations

**Files:**
- Create: `db/client.ts`
- Create: `db/schema/users.ts`, `db/schema/integration-accounts.ts`, `db/schema/tasks.ts`, `db/schema/memories.ts`, `db/schema/daily-briefings.ts`, `db/schema/agent.ts`, `db/schema/index.ts`
- Create: `db/vector-type.ts`
- Create: `drizzle.config.ts`
- Test: `db/schema/schema.test.ts`

**Interfaces:**
- Produces: `db` (Drizzle client, default export from `db/client.ts`), and every table object (`users`, `accounts`, `sessions`, `integrationAccounts`, `tasks`, `memories`, `dailyBriefings`, `agentRuns`, `agentActions`) re-exported from `db/schema/index.ts`. All later tasks import tables from `@/db/schema` and the client from `@/db/client`.

- [ ] **Step 1: Write the failing schema test**

```ts
// db/schema/schema.test.ts
import { describe, it, expect } from 'vitest';
import { tasks, memories, dailyBriefings, agentRuns, agentActions, integrationAccounts } from './index';

describe('schema exports', () => {
  it('exposes every V1 table', () => {
    expect(tasks).toBeDefined();
    expect(memories).toBeDefined();
    expect(dailyBriefings).toBeDefined();
    expect(agentRuns).toBeDefined();
    expect(agentActions).toBeDefined();
    expect(integrationAccounts).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run db/schema/schema.test.ts
```

Expected: FAIL — `./index` has no exported member (files don't exist yet).

- [ ] **Step 3: Write the custom vector type**

```ts
// db/vector-type.ts
import { customType } from 'drizzle-orm/pg-core';

export const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 512})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').filter(Boolean).map(Number);
  },
});
```

- [ ] **Step 4: Write the Auth.js-required tables**

```ts
// db/schema/users.ts
import { pgTable, text, timestamp, primaryKey, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
});

export const accounts = pgTable('accounts', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
}));

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.identifier, table.token] }),
}));
```

- [ ] **Step 5: Write the V1 domain tables**

```ts
// db/schema/integration-accounts.ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const integrationAccounts = pgTable('integration_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: ['google'] }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  scopes: text('scopes').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type IntegrationAccount = typeof integrationAccounts.$inferSelect;
```

```ts
// db/schema/tasks.ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  notes: text('notes'),
  dueDate: timestamp('due_date', { mode: 'date' }),
  status: text('status', { enum: ['open', 'completed', 'deleted'] }).notNull().default('open'),
  completedAt: timestamp('completed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
```

```ts
// db/schema/memories.ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { vector } from '../vector-type';

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 512 }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type Memory = typeof memories.$inferSelect;
```

```ts
// db/schema/daily-briefings.ts
import { pgTable, uuid, text, timestamp, jsonb, date } from 'drizzle-orm/pg-core';
import { users } from './users';

export const dailyBriefings = pgTable('daily_briefings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  briefingDate: date('briefing_date').notNull(),
  attentionItems: jsonb('attention_items').notNull(),
  digestItems: jsonb('digest_items').notNull(),
  generatedAt: timestamp('generated_at', { mode: 'date' }).notNull().defaultNow(),
});
export type DailyBriefing = typeof dailyBriefings.$inferSelect;
```

```ts
// db/schema/agent.ts
import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { users } from './users';

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  input: text('input').notNull(),
  toolCalls: jsonb('tool_calls'),
  latencyMs: integer('latency_ms'),
  tokenCost: integer('token_cost'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type AgentRun = typeof agentRuns.$inferSelect;

export const agentActions = pgTable('agent_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentRunId: uuid('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  status: text('status', { enum: ['success', 'error'] }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type AgentAction = typeof agentActions.$inferSelect;
export type NewAgentAction = typeof agentActions.$inferInsert;
```

```ts
// db/schema/index.ts
export * from './users';
export * from './integration-accounts';
export * from './tasks';
export * from './memories';
export * from './daily-briefings';
export * from './agent';
```

- [ ] **Step 6: Write the Drizzle client**

```ts
// db/client.ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!); // use Neon's pooled connection string (the "-pooler" host) here, not the direct one
export const db = drizzle(sql, { schema });
```

- [ ] **Step 7: Configure drizzle-kit and generate the initial migration**

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

```bash
pnpm dlx drizzle-kit generate
```

Expected: a new SQL file under `db/migrations/`. Open it and add, as the first statement, `CREATE EXTENSION IF NOT EXISTS vector;` (required before the `vector` column type can be created).

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run db/schema/schema.test.ts
```

Expected: PASS.

- [ ] **Step 9: Apply the migration to the dev Neon branch and add the pgvector index**

```bash
pnpm dlx drizzle-kit migrate
```

Then run once, directly against the DB (psql or Neon SQL editor):

```sql
CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 10: Commit**

```bash
git add db drizzle.config.ts
git commit -m "feat: add V1 database schema, migrations, and pgvector index"
```

---

## Task 3: Auth.js Google OAuth

**Files:**
- Create: `auth.ts`, `app/api/auth/[...nextauth]/route.ts`
- Modify: `.env.example` (add `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`)
- Test: `lib/auth/persist-integration-account.test.ts`
- Create: `lib/auth/persist-integration-account.ts`

**Interfaces:**
- Consumes: `db` from `@/db/client`, `integrationAccounts` from `@/db/schema`.
- Produces: `auth()` (session helper, from `auth.ts`, used by every server component/route that needs the current user) and `persistIntegrationAccount(userId, account)` (used by Task 3's own auth callback and by nothing else in V1).

- [ ] **Step 1: Write the failing test for token persistence**

```ts
// lib/auth/persist-integration-account.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistIntegrationAccount } from './persist-integration-account';
import { db } from '@/db/client';
import { integrationAccounts } from '@/db/schema';

vi.mock('@/db/client', () => ({
  db: { insert: vi.fn(), select: vi.fn() },
}));

describe('persistIntegrationAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores the Google access/refresh tokens and requested scopes for the user', async () => {
    const values = vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    (db.insert as any).mockReturnValue({ values });

    await persistIntegrationAccount('user-1', {
      accessToken: 'access-xyz',
      refreshToken: 'refresh-xyz',
      scopes: 'gmail.readonly gmail.compose calendar.readonly',
      expiresAt: new Date('2026-08-25T00:00:00Z'),
    });

    expect(db.insert).toHaveBeenCalledWith(integrationAccounts);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      provider: 'google',
      accessToken: 'access-xyz',
      refreshToken: 'refresh-xyz',
      scopes: 'gmail.readonly gmail.compose calendar.readonly',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/persist-integration-account.test.ts
```

Expected: FAIL — module `./persist-integration-account` not found.

- [ ] **Step 3: Implement the persistence function**

```ts
// lib/auth/persist-integration-account.ts
import { db } from '@/db/client';
import { integrationAccounts } from '@/db/schema';

export async function persistIntegrationAccount(userId: string, account: {
  accessToken: string;
  refreshToken?: string | null;
  scopes: string;
  expiresAt?: Date | null;
}) {
  await db.insert(integrationAccounts).values({
    userId,
    provider: 'google',
    accessToken: account.accessToken,
    refreshToken: account.refreshToken ?? null,
    scopes: account.scopes,
    expiresAt: account.expiresAt ?? null,
  }).onConflictDoUpdate({
    target: [integrationAccounts.userId, integrationAccounts.provider],
    set: {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken ?? null,
      scopes: account.scopes,
      expiresAt: account.expiresAt ?? null,
    },
  });
}
```

This requires a unique constraint on `(user_id, provider)` — add it to `db/schema/integration-accounts.ts`:

```ts
// add to the pgTable third argument in db/schema/integration-accounts.ts
}, (table) => ({
  userProviderUnique: uniqueIndex('integration_accounts_user_provider_idx').on(table.userId, table.provider),
}));
```

(Import `uniqueIndex` from `drizzle-orm/pg-core` in that file, then re-run `pnpm dlx drizzle-kit generate` and `pnpm dlx drizzle-kit migrate` to apply it.)

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/persist-integration-account.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire Auth.js with the Google provider and V1 scopes**

```ts
// auth.ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { persistIntegrationAccount } from '@/lib/auth/persist-integration-account';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: [
            'openid', 'email', 'profile',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.compose',
            'https://www.googleapis.com/auth/calendar.readonly',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google' && user.id) {
        await persistIntegrationAccount(user.id, {
          accessToken: account.access_token!,
          refreshToken: account.refresh_token,
          scopes: account.scope ?? '',
          expiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
        });
      }
      return true;
    },
  },
});
```

```ts
// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from '@/auth';
```

Note: `access_type: 'offline'` + `prompt: 'consent'` is required to get a `refresh_token` back from Google — without both, Google only returns one on the very first consent.

- [ ] **Step 6: Manual smoke test**

```bash
pnpm dev
```

Visit `http://localhost:3000/api/auth/signin`, sign in with Google, and confirm (via the Neon SQL editor or `psql`) a row exists in `integration_accounts` with `provider = 'google'` and a non-null `refresh_token`.

- [ ] **Step 7: Commit**

```bash
git add auth.ts app/api/auth db/schema/integration-accounts.ts db/migrations lib/auth
git commit -m "feat: add Google OAuth login and integration token persistence"
```

---

## Task 4: Tasks Domain Library

**Files:**
- Create: `lib/tasks/queries.ts`
- Test: `lib/tasks/queries.test.ts`

**Interfaces:**
- Consumes: `db` from `@/db/client`, `tasks`/`Task`/`NewTask` from `@/db/schema`.
- Produces: `createTask(userId, input)`, `updateTask(userId, taskId, input)`, `completeTask(userId, taskId)`, `deleteTask(userId, taskId)`, `searchTasks(userId, filter)` — all exported from `lib/tasks/queries.ts`. Task 9 (tool registry) imports these five functions directly.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/tasks/queries.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/client';
import { tasks } from '@/db/schema';
import { createTask, updateTask, completeTask, deleteTask, searchTasks } from './queries';
import { eq } from 'drizzle-orm';

const USER_A = 'user-a';
const USER_B = 'user-b';

beforeEach(async () => {
  await db.delete(tasks);
});

describe('tasks domain library', () => {
  it('creates a task owned by the given user', async () => {
    const task = await createTask(USER_A, { title: 'Finish assembler assignment' });
    expect(task.userId).toBe(USER_A);
    expect(task.title).toBe('Finish assembler assignment');
    expect(task.status).toBe('open');
  });

  it('updates the due date of a task the user owns', async () => {
    const task = await createTask(USER_A, { title: 'Reply to recruiter' });
    const friday = new Date('2026-08-28T00:00:00Z');
    const updated = await updateTask(USER_A, task.id, { dueDate: friday });
    expect(updated.dueDate).toEqual(friday);
  });

  it('refuses to update a task owned by a different user', async () => {
    const task = await createTask(USER_A, { title: 'Private task' });
    await expect(updateTask(USER_B, task.id, { title: 'hijacked' })).rejects.toThrow();
  });

  it('marks a task completed and stamps completedAt', async () => {
    const task = await createTask(USER_A, { title: 'Review Figma prototype' });
    const completed = await completeTask(USER_A, task.id);
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();
  });

  it('soft-deletes a task by setting status to deleted', async () => {
    const task = await createTask(USER_A, { title: 'Old task' });
    await deleteTask(USER_A, task.id);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.status).toBe('deleted');
  });

  it('searches only within the calling user\'s tasks', async () => {
    await createTask(USER_A, { title: 'Task for A' });
    await createTask(USER_B, { title: 'Task for B' });
    const results = await searchTasks(USER_A, {});
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Task for A');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run lib/tasks/queries.test.ts
```

Expected: FAIL — module `./queries` not found.

- [ ] **Step 3: Implement the tasks domain library**

```ts
// lib/tasks/queries.ts
import { db } from '@/db/client';
import { tasks, type Task } from '@/db/schema';
import { and, eq, lte, ilike } from 'drizzle-orm';

export async function createTask(userId: string, input: { title: string; dueDate?: Date; notes?: string }): Promise<Task> {
  const [task] = await db.insert(tasks).values({
    userId,
    title: input.title,
    dueDate: input.dueDate,
    notes: input.notes,
  }).returning();
  return task;
}

async function getOwnedTask(userId: string, taskId: string): Promise<Task> {
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  if (!task) throw new Error(`Task ${taskId} not found for this user`);
  return task;
}

export async function updateTask(userId: string, taskId: string, input: { title?: string; dueDate?: Date; notes?: string }): Promise<Task> {
  await getOwnedTask(userId, taskId);
  const [updated] = await db.update(tasks)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();
  return updated;
}

export async function completeTask(userId: string, taskId: string): Promise<Task> {
  await getOwnedTask(userId, taskId);
  const [updated] = await db.update(tasks)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();
  return updated;
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  await getOwnedTask(userId, taskId);
  await db.update(tasks)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
}

export async function searchTasks(userId: string, filter: { query?: string; status?: 'open' | 'completed' | 'deleted'; dueBefore?: Date }): Promise<Task[]> {
  const conditions = [eq(tasks.userId, userId)];
  if (filter.status) conditions.push(eq(tasks.status, filter.status));
  if (filter.dueBefore) conditions.push(lte(tasks.dueDate, filter.dueBefore));
  if (filter.query) conditions.push(ilike(tasks.title, `%${filter.query}%`));
  return db.select().from(tasks).where(and(...conditions));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run lib/tasks/queries.test.ts
```

Expected: PASS (6 tests). This requires `DATABASE_URL` in `.env.test` to point at a real (dev/test) Neon branch — Task 2 already applied the schema there.

- [ ] **Step 5: Commit**

```bash
git add lib/tasks
git commit -m "feat: add tasks domain library with user-scoped CRUD and search"
```

---

## Task 5: Memory Domain Library (Voyage Embeddings + pgvector)

**Files:**
- Create: `lib/ai/embeddings.ts`, `lib/memory/queries.ts`
- Test: `lib/ai/embeddings.test.ts`, `lib/memory/queries.test.ts`

**Interfaces:**
- Consumes: `db` from `@/db/client`, `memories`/`Memory` from `@/db/schema`, `vectorLiteral` helper (defined in this task).
- Produces: `embed(text): Promise<number[]>` (used by `lib/memory/queries.ts` and, later, by nothing else in V1) and `saveMemory(userId, content)`, `searchMemory(userId, query, limit?)` — imported by Task 9's tool registry.

- [ ] **Step 1: Write the failing embeddings test**

```ts
// lib/ai/embeddings.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embed } from './embeddings';

const originalFetch = global.fetch;

beforeEach(() => { global.fetch = originalFetch; });

describe('embed', () => {
  it('returns a 512-dimension vector for voyage-3-lite', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(512).fill(0.01) }] }),
    }) as any;

    const vector = await embed('remind me to ask Rahul about the API tomorrow');
    expect(vector).toHaveLength(512);
  });

  it('throws when the Voyage API returns an error status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }) as any;
    await expect(embed('anything')).rejects.toThrow('Voyage embedding request failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/ai/embeddings.test.ts
```

Expected: FAIL — module `./embeddings` not found.

- [ ] **Step 3: Implement the Voyage embeddings client**

```ts
// lib/ai/embeddings.ts
export async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: [text], model: 'voyage-3-lite' }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embedding request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.data[0].embedding as number[];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/ai/embeddings.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing memory queries test**

```ts
// lib/memory/queries.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/db/client';
import { memories } from '@/db/schema';
import { saveMemory, searchMemory } from './queries';

vi.mock('@/lib/ai/embeddings', () => ({
  embed: vi.fn(async (text: string) => {
    // deterministic fake embedding so semantic ordering is testable
    if (text.includes('Rahul')) return new Array(512).fill(0.9);
    if (text.includes('API')) return new Array(512).fill(0.89);
    return new Array(512).fill(0.1);
  }),
}));

const USER_A = 'user-a';

beforeEach(async () => { await db.delete(memories); });

describe('memory domain library', () => {
  it('stores a memory with its embedding', async () => {
    const memory = await saveMemory(USER_A, 'Ask Rahul about the API tomorrow');
    expect(memory.userId).toBe(USER_A);
    expect(memory.content).toBe('Ask Rahul about the API tomorrow');
  });

  it('returns the closest memory first for a semantically related query', async () => {
    await saveMemory(USER_A, 'Ask Rahul about the API tomorrow');
    await saveMemory(USER_A, 'Buy milk on the way home');
    const results = await searchMemory(USER_A, 'API', 5);
    expect(results[0].content).toBe('Ask Rahul about the API tomorrow');
  });

  it('only searches the calling user\'s memories', async () => {
    await saveMemory('user-b', 'Ask Rahul about the API tomorrow');
    const results = await searchMemory(USER_A, 'API', 5);
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run lib/memory/queries.test.ts
```

Expected: FAIL — module `./queries` not found.

- [ ] **Step 7: Implement the memory domain library**

```ts
// lib/memory/queries.ts
import { db } from '@/db/client';
import { memories, type Memory } from '@/db/schema';
import { embed } from '@/lib/ai/embeddings';
import { sql, eq } from 'drizzle-orm';

function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export async function saveMemory(userId: string, content: string): Promise<Memory> {
  const embedding = await embed(content);
  const [memory] = await db.insert(memories).values({ userId, content, embedding }).returning();
  return memory;
}

export async function searchMemory(userId: string, query: string, limit = 5): Promise<Memory[]> {
  const queryEmbedding = await embed(query);
  const literal = vectorLiteral(queryEmbedding);
  const rows = await db.execute<Memory>(sql`
    SELECT id, user_id AS "userId", content, embedding, created_at AS "createdAt"
    FROM memories
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
  return rows.rows;
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run lib/memory/queries.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add lib/ai/embeddings.ts lib/ai/embeddings.test.ts lib/memory
git commit -m "feat: add Voyage embeddings client and pgvector-backed memory search"
```

---

## Task 6: Email Capability — Gmail Adapter

**Files:**
- Create: `lib/integrations/types.ts`
- Create: `lib/integrations/gmail/client.ts`
- Test: `lib/integrations/gmail/client.test.ts`

**Interfaces:**
- Produces: `EmailMessage`, `EmailCapability`, `CalendarEvent`, `CalendarCapability`, `WebResult`, `WebCapability` interfaces (in `lib/integrations/types.ts`, consumed by Tasks 7, 8, 9) and `createGmailCapability(accessToken: string): EmailCapability` (consumed by Task 9).

- [ ] **Step 1: Write the shared capability interfaces**

```ts
// lib/integrations/types.ts
export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
}

export interface EmailCapability {
  search(query: string): Promise<EmailMessage[]>;
  read(id: string): Promise<EmailMessage & { body: string }>;
  draft(input: { to: string; subject: string; body: string }): Promise<{ draftId: string }>;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location?: string;
}

export interface CalendarCapability {
  search(range: { from: Date; to: Date }): Promise<CalendarEvent[]>;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebCapability {
  search(query: string): Promise<WebResult[]>;
  read(url: string): Promise<string>;
}
```

- [ ] **Step 2: Write the failing Gmail adapter test**

```ts
// lib/integrations/gmail/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createGmailCapability } from './client';

const mockUsersGet = vi.fn();
const mockUsersList = vi.fn();
const mockDraftsCreate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: () => ({
      users: {
        messages: { list: mockUsersList, get: mockUsersGet },
        drafts: { create: mockDraftsCreate },
      },
    }),
    auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })) },
  },
}));

describe('createGmailCapability', () => {
  it('searches messages and maps them to EmailMessage', async () => {
    mockUsersList.mockResolvedValue({ data: { messages: [{ id: 'msg-1' }] } });
    mockUsersGet.mockResolvedValue({
      data: {
        id: 'msg-1',
        snippet: 'Hi, following up on the API access request...',
        internalDate: `${new Date('2026-08-24T09:00:00Z').getTime()}`,
        payload: { headers: [
          { name: 'From', value: 'recruiter@example.com' },
          { name: 'Subject', value: 'Following up' },
        ] },
      },
    });

    const gmail = createGmailCapability('fake-access-token');
    const results = await gmail.search('recruiter');

    expect(results).toEqual([{
      id: 'msg-1',
      from: 'recruiter@example.com',
      subject: 'Following up',
      snippet: 'Hi, following up on the API access request...',
      receivedAt: new Date('2026-08-24T09:00:00Z'),
    }]);
  });

  it('creates a draft via the Gmail API', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'draft-1' } });
    const gmail = createGmailCapability('fake-access-token');
    const result = await gmail.draft({ to: 'recruiter@example.com', subject: 'Re: Following up', body: 'Thanks for reaching out.' });
    expect(result).toEqual({ draftId: 'draft-1' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm vitest run lib/integrations/gmail/client.test.ts
```

Expected: FAIL — module `./client` not found.

- [ ] **Step 4: Implement the Gmail adapter**

```ts
// lib/integrations/gmail/client.ts
import { google } from 'googleapis';
import type { EmailCapability, EmailMessage } from '../types';

function header(headers: { name?: string | null; value?: string | null }[] | undefined, name: string): string {
  return headers?.find((h) => h.name === name)?.value ?? '';
}

export function createGmailCapability(accessToken: string): EmailCapability {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  return {
    async search(query: string): Promise<EmailMessage[]> {
      const list = await gmail.users.messages.list({ userId: 'me', q: query });
      const ids = list.data.messages ?? [];
      const messages = await Promise.all(ids.map(async ({ id }) => {
        const msg = await gmail.users.messages.get({ userId: 'me', id: id! });
        return {
          id: msg.data.id!,
          from: header(msg.data.payload?.headers, 'From'),
          subject: header(msg.data.payload?.headers, 'Subject'),
          snippet: msg.data.snippet ?? '',
          receivedAt: new Date(Number(msg.data.internalDate)),
        };
      }));
      return messages;
    },

    async read(id: string) {
      const msg = await gmail.users.messages.get({ userId: 'me', id });
      return {
        id: msg.data.id!,
        from: header(msg.data.payload?.headers, 'From'),
        subject: header(msg.data.payload?.headers, 'Subject'),
        snippet: msg.data.snippet ?? '',
        receivedAt: new Date(Number(msg.data.internalDate)),
        body: msg.data.snippet ?? '',
      };
    },

    async draft({ to, subject, body }) {
      const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`).toString('base64url');
      const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
      return { draftId: res.data.id! };
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm vitest run lib/integrations/gmail/client.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/types.ts lib/integrations/gmail
git commit -m "feat: add EmailCapability interface and Gmail adapter"
```

---

## Task 7: Calendar Capability — Google Calendar Adapter

**Files:**
- Create: `lib/integrations/calendar/client.ts`
- Test: `lib/integrations/calendar/client.test.ts`

**Interfaces:**
- Consumes: `CalendarCapability`, `CalendarEvent` from `@/lib/integrations/types` (Task 6).
- Produces: `createCalendarCapability(accessToken: string): CalendarCapability` (consumed by Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// lib/integrations/calendar/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createCalendarCapability } from './client';

const mockEventsList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({ events: { list: mockEventsList } }),
    auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })) },
  },
}));

describe('createCalendarCapability', () => {
  it('maps Google Calendar events into CalendarEvent for a date range', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [{
        id: 'evt-1',
        summary: 'Review Figma prototype',
        start: { dateTime: '2026-08-24T15:00:00Z' },
        end: { dateTime: '2026-08-24T15:30:00Z' },
        location: 'Zoom',
      }] },
    });

    const calendar = createCalendarCapability('fake-access-token');
    const results = await calendar.search({ from: new Date('2026-08-24T00:00:00Z'), to: new Date('2026-08-25T00:00:00Z') });

    expect(results).toEqual([{
      id: 'evt-1',
      title: 'Review Figma prototype',
      start: new Date('2026-08-24T15:00:00Z'),
      end: new Date('2026-08-24T15:30:00Z'),
      location: 'Zoom',
    }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/integrations/calendar/client.test.ts
```

Expected: FAIL — module `./client` not found.

- [ ] **Step 3: Implement the Calendar adapter**

```ts
// lib/integrations/calendar/client.ts
import { google } from 'googleapis';
import type { CalendarCapability, CalendarEvent } from '../types';

export function createCalendarCapability(accessToken: string): CalendarCapability {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: 'v3', auth });

  return {
    async search({ from, to }): Promise<CalendarEvent[]> {
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      return (res.data.items ?? []).map((e) => ({
        id: e.id!,
        title: e.summary ?? '(no title)',
        start: new Date(e.start?.dateTime ?? e.start?.date!),
        end: new Date(e.end?.dateTime ?? e.end?.date!),
        location: e.location ?? undefined,
      }));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/integrations/calendar/client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/calendar
git commit -m "feat: add read-only Google Calendar adapter"
```

---

## Task 8: Web Capability — Tavily Adapter

**Files:**
- Create: `lib/integrations/web/client.ts`
- Test: `lib/integrations/web/client.test.ts`

**Interfaces:**
- Consumes: `WebCapability`, `WebResult` from `@/lib/integrations/types` (Task 6).
- Produces: `createWebCapability(apiKey: string): WebCapability` (consumed by Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// lib/integrations/web/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebCapability } from './client';

const originalFetch = global.fetch;
beforeEach(() => { global.fetch = originalFetch; });

describe('createWebCapability', () => {
  it('searches via the Tavily API and maps results', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: 'Speculative Decoding explained', url: 'https://example.com/spec-decoding', content: 'A technique that...' }] }),
    }) as any;

    const web = createWebCapability('fake-tavily-key');
    const results = await web.search('speculative decoding');

    expect(results).toEqual([{ title: 'Speculative Decoding explained', url: 'https://example.com/spec-decoding', snippet: 'A technique that...' }]);
  });

  it('reads full page content via the Tavily extract endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ raw_content: 'Full article text.' }] }),
    }) as any;

    const web = createWebCapability('fake-tavily-key');
    const content = await web.read('https://example.com/spec-decoding');
    expect(content).toBe('Full article text.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/integrations/web/client.test.ts
```

Expected: FAIL — module `./client` not found.

- [ ] **Step 3: Implement the Tavily adapter**

```ts
// lib/integrations/web/client.ts
import type { WebCapability, WebResult } from '../types';

export function createWebCapability(apiKey: string): WebCapability {
  return {
    async search(query: string): Promise<WebResult[]> {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query }),
      });
      if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
      const json = await res.json();
      return json.results.map((r: any) => ({ title: r.title, url: r.url, snippet: r.content }));
    },

    async read(url: string): Promise<string> {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, urls: [url] }),
      });
      if (!res.ok) throw new Error(`Tavily extract failed: ${res.status}`);
      const json = await res.json();
      return json.results[0]?.raw_content ?? '';
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/integrations/web/client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/web
git commit -m "feat: add Tavily-backed web search capability"
```

---

## Task 9: AI Tool Registry

**Files:**
- Create: `lib/ai/idempotency.ts`, `lib/ai/tools/index.ts`
- Test: `lib/ai/idempotency.test.ts`, `lib/ai/tools/index.test.ts`

**Interfaces:**
- Consumes: all five `lib/tasks/queries.ts` functions (Task 4), `saveMemory`/`searchMemory` (Task 5), `EmailCapability`/`CalendarCapability`/`WebCapability` (Tasks 6-8), `agentActions` table (Task 2).
- Produces: `buildToolRegistry(ctx: ToolContext)` returning an object of Vercel AI SDK `tool()` definitions keyed by the 11 V1 tool names — consumed by Task 10's orchestrator. `ToolContext` type (`{ userId, agentRunId, email, calendar, web }`) is also exported and reused by Task 10.

- [ ] **Step 1: Write the failing idempotency test**

```ts
// lib/ai/idempotency.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withIdempotency } from './idempotency';
import { db } from '@/db/client';

vi.mock('@/db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));

describe('withIdempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the action and records it when the key has not been seen', async () => {
    (db.select as any).mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    const values = vi.fn().mockResolvedValue(undefined);
    (db.insert as any).mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-1' });
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-1', input: { title: 'x' } }, action);

    expect(action).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 'task-1' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'key-1', status: 'success' }));
  });

  it('skips re-running the action when the key was already recorded', async () => {
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ output: { id: 'task-1' } }]) }),
    });

    const action = vi.fn();
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-1', input: { title: 'x' } }, action);

    expect(action).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'task-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/ai/idempotency.test.ts
```

Expected: FAIL — module `./idempotency` not found.

- [ ] **Step 3: Implement idempotency wrapper**

```ts
// lib/ai/idempotency.ts
import { db } from '@/db/client';
import { agentActions } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function withIdempotency<T>(
  ctx: { agentRunId: string; toolName: string; idempotencyKey: string; input: unknown },
  action: () => Promise<T>,
): Promise<T> {
  const existing = await db.select().from(agentActions).where(eq(agentActions.idempotencyKey, ctx.idempotencyKey));
  if (existing.length > 0) {
    return existing[0].output as T;
  }

  try {
    const output = await action();
    await db.insert(agentActions).values({
      agentRunId: ctx.agentRunId,
      toolName: ctx.toolName,
      input: ctx.input,
      output,
      idempotencyKey: ctx.idempotencyKey,
      status: 'success',
    });
    return output;
  } catch (err) {
    await db.insert(agentActions).values({
      agentRunId: ctx.agentRunId,
      toolName: ctx.toolName,
      input: ctx.input,
      output: { error: String(err) },
      idempotencyKey: ctx.idempotencyKey,
      status: 'error',
    });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/ai/idempotency.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing tool registry test**

```ts
// lib/ai/tools/index.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildToolRegistry } from './index';

vi.mock('@/lib/tasks/queries', () => ({
  createTask: vi.fn(async (userId, input) => ({ id: 'task-1', userId, ...input, status: 'open' })),
  updateTask: vi.fn(), completeTask: vi.fn(), deleteTask: vi.fn(), searchTasks: vi.fn(async () => []),
}));
vi.mock('@/lib/memory/queries', () => ({
  saveMemory: vi.fn(async (userId, content) => ({ id: 'mem-1', userId, content })),
  searchMemory: vi.fn(async () => []),
}));
vi.mock('@/lib/ai/idempotency', () => ({
  withIdempotency: vi.fn((_ctx, action) => action()),
}));

describe('buildToolRegistry', () => {
  it('exposes exactly the 11 V1 tools', () => {
    const registry = buildToolRegistry({
      userId: 'user-1',
      agentRunId: 'run-1',
      email: { search: vi.fn(), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn() },
      web: { search: vi.fn(), read: vi.fn() },
    });

    expect(Object.keys(registry).sort()).toEqual([
      'complete_task', 'create_email_draft', 'create_task', 'delete_task',
      'list_calendar_events', 'save_memory', 'search_email', 'search_memory',
      'search_tasks', 'search_web', 'update_task',
    ]);
  });

  it('create_task executes through withIdempotency and returns the created task', async () => {
    const registry = buildToolRegistry({
      userId: 'user-1', agentRunId: 'run-1',
      email: { search: vi.fn(), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn() },
      web: { search: vi.fn(), read: vi.fn() },
    });

    const result = await registry.create_task.execute({ title: 'Finish assembler assignment' }, { toolCallId: 'call-1', messages: [] } as any);
    expect(result).toEqual(expect.objectContaining({ title: 'Finish assembler assignment', userId: 'user-1' }));
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run lib/ai/tools/index.test.ts
```

Expected: FAIL — module `./index` not found.

- [ ] **Step 7: Implement the tool registry**

```ts
// lib/ai/tools/index.ts
import { tool } from 'ai';
import { z } from 'zod';
import { createTask, updateTask, completeTask, deleteTask, searchTasks } from '@/lib/tasks/queries';
import { saveMemory, searchMemory } from '@/lib/memory/queries';
import { withIdempotency } from '@/lib/ai/idempotency';
import type { EmailCapability, CalendarCapability, WebCapability } from '@/lib/integrations/types';

export interface ToolContext {
  userId: string;
  agentRunId: string;
  email: EmailCapability;
  calendar: CalendarCapability;
  web: WebCapability;
}

export function buildToolRegistry(ctx: ToolContext) {
  const idempotent = <T>(toolName: string, toolCallId: string, input: unknown, action: () => Promise<T>) =>
    withIdempotency({ agentRunId: ctx.agentRunId, toolName, idempotencyKey: `${ctx.agentRunId}:${toolCallId}`, input }, action);

  return {
    create_task: tool({
      description: 'Create a new task for the user.',
      parameters: z.object({ title: z.string(), dueDate: z.string().datetime().optional(), notes: z.string().optional() }),
      execute: async ({ title, dueDate, notes }, { toolCallId }) =>
        idempotent('create_task', toolCallId, { title, dueDate, notes }, () =>
          createTask(ctx.userId, { title, notes, dueDate: dueDate ? new Date(dueDate) : undefined })),
    }),

    update_task: tool({
      description: 'Update an existing task the user owns (title, due date, or notes).',
      parameters: z.object({ taskId: z.string(), title: z.string().optional(), dueDate: z.string().datetime().optional(), notes: z.string().optional() }),
      execute: async ({ taskId, title, dueDate, notes }, { toolCallId }) =>
        idempotent('update_task', toolCallId, { taskId, title, dueDate, notes }, () =>
          updateTask(ctx.userId, taskId, { title, notes, dueDate: dueDate ? new Date(dueDate) : undefined })),
    }),

    complete_task: tool({
      description: 'Mark a task as completed.',
      parameters: z.object({ taskId: z.string() }),
      execute: async ({ taskId }, { toolCallId }) =>
        idempotent('complete_task', toolCallId, { taskId }, () => completeTask(ctx.userId, taskId)),
    }),

    delete_task: tool({
      description: 'Delete (soft-delete) a task.',
      parameters: z.object({ taskId: z.string() }),
      execute: async ({ taskId }, { toolCallId }) =>
        idempotent('delete_task', toolCallId, { taskId }, () => deleteTask(ctx.userId, taskId)),
    }),

    search_tasks: tool({
      description: 'Search the user\'s tasks by title text, status, or due date, to find the right task before acting on it.',
      parameters: z.object({ query: z.string().optional(), status: z.enum(['open', 'completed', 'deleted']).optional(), dueBefore: z.string().datetime().optional() }),
      execute: async ({ query, status, dueBefore }) =>
        searchTasks(ctx.userId, { query, status, dueBefore: dueBefore ? new Date(dueBefore) : undefined }),
    }),

    save_memory: tool({
      description: 'Save a freeform memory or reminder for later semantic recall.',
      parameters: z.object({ content: z.string() }),
      execute: async ({ content }, { toolCallId }) =>
        idempotent('save_memory', toolCallId, { content }, () => saveMemory(ctx.userId, content)),
    }),

    search_memory: tool({
      description: 'Semantically search the user\'s saved memories.',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => searchMemory(ctx.userId, query),
    }),

    search_email: tool({
      description: 'Search the user\'s Gmail inbox.',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ctx.email.search(query),
    }),

    create_email_draft: tool({
      description: 'Create a Gmail draft reply or new email.',
      parameters: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      execute: async (input, { toolCallId }) =>
        idempotent('create_email_draft', toolCallId, input, () => ctx.email.draft(input)),
    }),

    list_calendar_events: tool({
      description: 'List the user\'s Google Calendar events in a date range (read-only).',
      parameters: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
      execute: async ({ from, to }) => ctx.calendar.search({ from: new Date(from), to: new Date(to) }),
    }),

    search_web: tool({
      description: 'Search the public web for information not available in the user\'s own data.',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ctx.web.search(query),
    }),
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run lib/ai/tools/index.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add lib/ai/idempotency.ts lib/ai/tools
git commit -m "feat: add idempotent, Zod-typed V1 tool registry"
```

---

## Task 10: AI Orchestrator

**Files:**
- Create: `lib/ai/orchestrator.ts`
- Test: `lib/ai/orchestrator.test.ts`

**Interfaces:**
- Consumes: `buildToolRegistry`, `ToolContext` (Task 9), `agentRuns` table (Task 2), `@ai-sdk/anthropic` + `ai`.
- Produces: `runCommand(ctx: Omit<ToolContext, 'agentRunId'>, input: string): Promise<{ message: string }>` — consumed by Task 12 (command bar API route) and Task 14 (daily briefing job, for digest summarization).

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runCommand } from './orchestrator';

vi.mock('@/db/client', () => ({
  db: { insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: 'run-1' }]) })) })) },
}));

const mockGenerateText = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: (...args: any[]) => mockGenerateText(...args) };
});

describe('runCommand', () => {
  it('logs an agent_run and returns the model\'s final confirmation text', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Moved it to Friday.', steps: [{ toolCalls: [{ toolName: 'update_task' }] }], usage: { totalTokens: 120 } });

    const result = await runCommand({
      userId: 'user-1',
      email: { search: vi.fn(), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn() },
      web: { search: vi.fn(), read: vi.fn() },
    }, 'Move the assignment to Friday');

    expect(result.message).toBe('Moved it to Friday.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/ai/orchestrator.test.ts
```

Expected: FAIL — module `./orchestrator` not found.

- [ ] **Step 3: Implement the orchestrator**

```ts
// lib/ai/orchestrator.ts
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { db } from '@/db/client';
import { agentRuns } from '@/db/schema';
import { buildToolRegistry, type ToolContext } from '@/lib/ai/tools';

const SYSTEM_PROMPT = `You are the command-bar assistant for a personal productivity app.
You can create/update/complete/delete/search the user's tasks, save/search their memories,
search their email, draft email replies, list their calendar (read-only), and search the web.
If a command is ambiguous (e.g. more than one task could match "the assignment"), call
search_tasks first and, if still ambiguous, ask the user ONE clarifying question instead of guessing.
Always end with a short, concrete confirmation of what you did (e.g. "Moved it to Friday.").`;

export async function runCommand(ctx: Omit<ToolContext, 'agentRunId'>, input: string): Promise<{ message: string }> {
  const start = Date.now();
  const [run] = await db.insert(agentRuns).values({ userId: ctx.userId, input }).returning();

  const tools = buildToolRegistry({ ...ctx, agentRunId: run.id });

  const result = await generateText({
    model: anthropic('claude-sonnet-5'),
    system: SYSTEM_PROMPT,
    prompt: input,
    tools,
    maxSteps: 5,
  });

  await db.update(agentRuns).set({
    toolCalls: result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
    latencyMs: Date.now() - start,
    tokenCost: result.usage?.totalTokens ?? null,
  }).where(eqRunId(run.id));

  return { message: result.text };
}

// local helper kept next to its only caller
import { eq } from 'drizzle-orm';
function eqRunId(id: string) {
  return eq(agentRuns.id, id);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/ai/orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/orchestrator.ts
git commit -m "feat: add single-agent Claude tool-calling orchestrator"
```

---

## Task 11: Rate Limiting

**Files:**
- Create: `lib/rate-limit.ts`
- Test: `lib/rate-limit.test.ts`
- Modify: `lib/ai/orchestrator.ts` (call the limiter before `generateText`)

**Interfaces:**
- Produces: `checkRateLimit(userId: string, bucket: 'ai' | 'integration'): Promise<{ allowed: boolean }>` — consumed by `runCommand` (Task 10) and, in Task 14, by the daily briefing job before it calls the Gmail/Calendar adapters.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rate-limit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit } from './rate-limit';

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() { return {}; }
    limit = vi.fn().mockResolvedValue({ success: true });
  },
}));
vi.mock('@upstash/redis', () => ({ Redis: class { static fromEnv() { return {}; } } }));

describe('checkRateLimit', () => {
  it('allows a request within the AI bucket limit', async () => {
    const result = await checkRateLimit('user-1', 'ai');
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/rate-limit.test.ts
```

Expected: FAIL — module `./rate-limit` not found.

- [ ] **Step 3: Implement rate limiting**

```ts
// lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const limiters = {
  ai: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '1 m'), prefix: 'ratelimit:ai' }),
  integration: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, '1 m'), prefix: 'ratelimit:integration' }),
};

export async function checkRateLimit(userId: string, bucket: 'ai' | 'integration'): Promise<{ allowed: boolean }> {
  const { success } = await limiters[bucket].limit(userId);
  return { allowed: success };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/rate-limit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire the limiter into the orchestrator**

In `lib/ai/orchestrator.ts`, add near the top of `runCommand`:

```ts
import { checkRateLimit } from '@/lib/rate-limit';

// inside runCommand, before the db.insert(agentRuns) call:
const { allowed } = await checkRateLimit(ctx.userId, 'ai');
if (!allowed) {
  return { message: "You've hit the rate limit for commands — try again in a minute." };
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/rate-limit.ts lib/ai/orchestrator.ts
git commit -m "feat: rate-limit AI and integration calls per user via Upstash"
```

---

## Task 12: Command Bar UI

**Files:**
- Create: `app/api/command/route.ts`
- Create: `components/command-bar/command-bar.tsx`
- Modify: `app/layout.tsx` (mount `<CommandBar />` globally)
- Test: `app/api/command/route.test.ts`

**Interfaces:**
- Consumes: `runCommand` (Task 10), `auth` (Task 3), `createGmailCapability`/`createCalendarCapability`/`createWebCapability` (Tasks 6-8), `integrationAccounts` table (Task 2).
- Produces: `POST /api/command` accepting `{ input: string }`, returning `{ message: string }` — consumed by `components/command-bar/command-bar.tsx`.

- [ ] **Step 1: Write the failing route test**

```ts
// app/api/command/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }) }));
vi.mock('@/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([{ accessToken: 'tok', provider: 'google' }]) }) }) },
}));
vi.mock('@/lib/ai/orchestrator', () => ({ runCommand: vi.fn().mockResolvedValue({ message: 'Moved it to Friday.' }) }));

describe('POST /api/command', () => {
  it('returns the orchestrator\'s confirmation message for a signed-in user', async () => {
    const req = new Request('http://localhost/api/command', {
      method: 'POST',
      body: JSON.stringify({ input: 'Move the assignment to Friday' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json).toEqual({ message: 'Moved it to Friday.' });
  });

  it('returns 401 when there is no session', async () => {
    const { auth } = await import('@/auth');
    (auth as any).mockResolvedValueOnce(null);
    const req = new Request('http://localhost/api/command', { method: 'POST', body: JSON.stringify({ input: 'hi' }) });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run app/api/command/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement the route handler**

```ts
// app/api/command/route.ts
import { auth } from '@/auth';
import { db } from '@/db/client';
import { integrationAccounts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { runCommand } from '@/lib/ai/orchestrator';
import { createGmailCapability } from '@/lib/integrations/gmail/client';
import { createCalendarCapability } from '@/lib/integrations/calendar/client';
import { createWebCapability } from '@/lib/integrations/web/client';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { input } = await req.json();
  const [account] = await db.select().from(integrationAccounts).where(eq(integrationAccounts.userId, session.user.id));

  const result = await runCommand({
    userId: session.user.id,
    email: createGmailCapability(account.accessToken),
    calendar: createCalendarCapability(account.accessToken),
    web: createWebCapability(process.env.TAVILY_API_KEY!),
  }, input);

  return Response.json(result);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run app/api/command/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Build the command bar component**

```tsx
// components/command-bar/command-bar.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { Command, CommandInput } from '@/components/ui/command';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AnimatedTooltip } from '@/components/ui/animated-tooltip';

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  async function submit(value: string) {
    setPending(true);
    setMessage(null);
    const res = await fetch('/api/command', { method: 'POST', body: JSON.stringify({ input: value }) });
    const json = await res.json();
    setMessage(json.message ?? json.error);
    setPending(false);
    setInput('');
  }

  function startVoice() {
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage('Voice input is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      submit(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <Command>
          <CommandInput
            placeholder="Speak or type..."
            value={input}
            onValueChange={setInput}
            onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) submit(input); }}
          />
        </Command>
        <button onClick={startVoice} aria-label="Start voice input">🎙️</button>
        {pending && <p>Thinking…</p>}
        {message && (
          <div role="status">
            <AnimatedTooltip text={message} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

`AnimatedTooltip`'s actual prop name for its display text may differ from `text` once pulled from the live VengeanceUI registry (Step 3 of Task 1) — check the generated `components/ui/animated-tooltip.tsx` and adjust the prop name to match; the behavior needed here is just "render this confirmation string with the component's built-in entrance animation."

- [ ] **Step 6: Mount it globally**

```tsx
// app/layout.tsx — add inside the root <body>, as a sibling of {children}
import { CommandBar } from '@/components/command-bar/command-bar';
// ...
<CommandBar />
```

- [ ] **Step 7: Manual smoke test**

```bash
pnpm dev
```

Sign in, press ⌘K, type "Create a task called test task", press Enter. Expected: a confirmation message appears and a row exists in `tasks` for that user.

- [ ] **Step 8: Commit**

```bash
git add app/api/command components/command-bar app/layout.tsx
git commit -m "feat: add global command bar with text and voice input"
```

---

## Task 13: Tasks UI Page

**Files:**
- Create: `app/(app)/tasks/page.tsx`
- Create: `components/tasks/task-list.tsx`
- Test: `components/tasks/task-list.test.tsx`

**Interfaces:**
- Consumes: `Task` type (Task 2), `searchTasks` (Task 4), `auth` (Task 3).
- Produces: `<TaskList tasks={Task[]} />` component (this task's own consumer only — the page).

- [ ] **Step 1: Write the failing component test**

```tsx
// components/tasks/task-list.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskList } from './task-list';

describe('TaskList', () => {
  it('renders each task\'s title and due date', () => {
    render(<TaskList tasks={[
      { id: '1', userId: 'u1', title: 'Reply to recruiter', notes: null, dueDate: new Date('2026-08-25'), status: 'open', completedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ]} />);
    expect(screen.getByText('Reply to recruiter')).toBeInTheDocument();
  });

  it('shows an empty state when there are no open tasks', () => {
    render(<TaskList tasks={[]} />);
    expect(screen.getByText(/nothing on your list/i)).toBeInTheDocument();
  });
});
```

Add `@testing-library/react` and `jsdom` for this test:

```bash
pnpm add -D @testing-library/react jsdom
```

Update `vitest.config.ts`'s `test` block to add `environment: 'jsdom'` for files matching `components/**` — simplest approach for V1: set `environment: 'jsdom'` globally (the DB tests in earlier tasks run fine under jsdom too, since they don't touch the DOM).

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run components/tasks/task-list.test.tsx
```

Expected: FAIL — module `./task-list` not found.

- [ ] **Step 3: Implement the component**

```tsx
// components/tasks/task-list.tsx
import type { Task } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <p>Nothing on your list. Enjoy it.</p>;
  }
  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <li key={task.id}>
          <Card className="p-4 flex items-center justify-between">
            <span>{task.title}</span>
            {task.dueDate && <Badge>{task.dueDate.toLocaleDateString()}</Badge>}
          </Card>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run components/tasks/task-list.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Wire the page**

```tsx
// app/(app)/tasks/page.tsx
import { auth } from '@/auth';
import { searchTasks } from '@/lib/tasks/queries';
import { TaskList } from '@/components/tasks/task-list';

export default async function TasksPage() {
  const session = await auth();
  const tasks = await searchTasks(session!.user!.id!, { status: 'open' });
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Tasks</h1>
      <TaskList tasks={tasks} />
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/tasks app/\(app\)/tasks vitest.config.ts package.json
git commit -m "feat: add tasks list page"
```

---

## Task 14: Daily Briefing Inngest Function

**Files:**
- Create: `inngest/client.ts`, `inngest/daily-briefing.ts`
- Create: `app/api/inngest/route.ts`
- Test: `inngest/daily-briefing.test.ts`

**Interfaces:**
- Consumes: `createGmailCapability`, `createCalendarCapability` (Tasks 6-7), `searchTasks` (Task 4), `dailyBriefings` table (Task 2), `checkRateLimit` (Task 11), Anthropic client via `ai`/`@ai-sdk/anthropic`.
- Produces: `dailyBriefingFn` (Inngest function, registered in `app/api/inngest/route.ts`; this task's own consumer only for V1).

- [ ] **Step 1: Write the failing test**

```ts
// inngest/daily-briefing.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateBriefing } from './daily-briefing';

vi.mock('@/lib/tasks/queries', () => ({ searchTasks: vi.fn().mockResolvedValue([{ title: 'Finish assembler assignment', dueDate: new Date('2026-08-24') }]) }));
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn().mockResolvedValue({ text: JSON.stringify({ attentionItems: ['Finish assembler assignment'], digestItems: ['Speculative decoding trended today'] }) }) };
});

describe('generateBriefing', () => {
  it('combines email, calendar, and task signals into attention + digest items', async () => {
    const briefing = await generateBriefing({
      userId: 'user-1',
      email: { search: vi.fn().mockResolvedValue([]), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn().mockResolvedValue([]) },
    });

    expect(briefing.attentionItems).toContain('Finish assembler assignment');
    expect(briefing.digestItems.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run inngest/daily-briefing.test.ts
```

Expected: FAIL — module `./daily-briefing` not found.

- [ ] **Step 3: Implement briefing generation and the Inngest function**

```ts
// inngest/client.ts
import { Inngest } from 'inngest';
export const inngest = new Inngest({ id: 'personal-os' });
```

```ts
// inngest/daily-briefing.ts
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { db } from '@/db/client';
import { dailyBriefings } from '@/db/schema';
import { searchTasks } from '@/lib/tasks/queries';
import { inngest } from './client';
import type { EmailCapability, CalendarCapability } from '@/lib/integrations/types';

export async function generateBriefing(ctx: { userId: string; email: EmailCapability; calendar: CalendarCapability }) {
  const [emails, events, tasks] = await Promise.all([
    ctx.email.search('is:unread'),
    ctx.calendar.search({ from: new Date(), to: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
    searchTasks(ctx.userId, { status: 'open' }),
  ]);

  const result = await generateText({
    model: anthropic('claude-sonnet-5'),
    prompt: `Given these unread emails: ${JSON.stringify(emails)}, today's calendar: ${JSON.stringify(events)}, and open tasks: ${JSON.stringify(tasks)}, respond with strict JSON: { "attentionItems": string[], "digestItems": string[] }. attentionItems is what genuinely needs action today (max 5). digestItems is a short "things to know" summary (max 5).`,
  });

  return JSON.parse(result.text) as { attentionItems: string[]; digestItems: string[] };
}

export const dailyBriefingFn = inngest.createFunction(
  { id: 'daily-briefing', retries: 3 },
  { cron: '0 8 * * *' },
  async ({ step }) => {
    // V1: iterate integration_accounts directly; a per-user fan-out event is a
    // straightforward Phase 2 change once user volume justifies it.
    const { db } = await import('@/db/client');
    const { integrationAccounts } = await import('@/db/schema');
    const { createGmailCapability } = await import('@/lib/integrations/gmail/client');
    const { createCalendarCapability } = await import('@/lib/integrations/calendar/client');

    const accounts = await step.run('load-accounts', () => db.select().from(integrationAccounts));

    for (const account of accounts) {
      await step.run(`briefing-${account.userId}`, async () => {
        const briefing = await generateBriefing({
          userId: account.userId,
          email: createGmailCapability(account.accessToken),
          calendar: createCalendarCapability(account.accessToken),
        });
        await db.insert(dailyBriefings).values({
          userId: account.userId,
          briefingDate: new Date().toISOString().slice(0, 10),
          attentionItems: briefing.attentionItems,
          digestItems: briefing.digestItems,
        });
      });
    }
  },
);
```

```ts
// app/api/inngest/route.ts
import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { dailyBriefingFn } from '@/inngest/daily-briefing';

export const { GET, POST, PUT } = serve({ client: inngest, functions: [dailyBriefingFn] });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run inngest/daily-briefing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add inngest app/api/inngest
git commit -m "feat: add scheduled daily briefing generation via Inngest"
```

---

## Task 15: Today UI Page

**Files:**
- Create: `app/(app)/today/page.tsx`
- Create: `components/briefing/briefing-view.tsx`
- Test: `components/briefing/briefing-view.test.tsx`

**Interfaces:**
- Consumes: `DailyBriefing` type (Task 2), `dailyBriefings` table (Task 2), `auth` (Task 3).
- Produces: `<BriefingView briefing={DailyBriefing | null} />` (this task's own consumer only).

- [ ] **Step 1: Write the failing component test**

```tsx
// components/briefing/briefing-view.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BriefingView } from './briefing-view';

describe('BriefingView', () => {
  it('renders attention and digest items from the briefing', () => {
    render(<BriefingView briefing={{
      id: '1', userId: 'u1', briefingDate: '2026-08-24',
      attentionItems: ['Reply to recruiter'], digestItems: ['Speculative decoding trended today'],
      generatedAt: new Date(),
    }} />);
    expect(screen.getByText('Reply to recruiter')).toBeInTheDocument();
    expect(screen.getByText('Speculative decoding trended today')).toBeInTheDocument();
  });

  it('shows a waiting state when no briefing has been generated yet', () => {
    render(<BriefingView briefing={null} />);
    expect(screen.getByText(/briefing is being prepared/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run components/briefing/briefing-view.test.tsx
```

Expected: FAIL — module `./briefing-view` not found.

- [ ] **Step 3: Implement the component**

```tsx
// components/briefing/briefing-view.tsx
import type { DailyBriefing } from '@/db/schema';

export function BriefingView({ briefing }: { briefing: DailyBriefing | null }) {
  if (!briefing) {
    return <p>Your briefing is being prepared — check back shortly.</p>;
  }
  const attentionItems = briefing.attentionItems as string[];
  const digestItems = briefing.digestItems as string[];
  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold">What needs your attention</h2>
        <ul>{attentionItems.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <section>
        <h2 className="font-semibold">Things to know</h2>
        <ul>{digestItems.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run components/briefing/briefing-view.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Wire the page**

```tsx
// app/(app)/today/page.tsx
import { auth } from '@/auth';
import { db } from '@/db/client';
import { dailyBriefings } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { BriefingView } from '@/components/briefing/briefing-view';

export default async function TodayPage() {
  const session = await auth();
  const [briefing] = await db.select().from(dailyBriefings)
    .where(eq(dailyBriefings.userId, session!.user!.id!))
    .orderBy(desc(dailyBriefings.generatedAt))
    .limit(1);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Today</h1>
      <BriefingView briefing={briefing ?? null} />
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/briefing app/\(app\)/today
git commit -m "feat: add Today page rendering the latest daily briefing"
```

---

## Task 16: Deployment Wiring & End-to-End Smoke Test

**Files:**
- Create: `.env.example` (finalize with every var used above)
- Modify: `package.json` (add `postinstall` migration hint, verify scripts)
- Create: `docs/superpowers/plans/deployment-checklist.md`

**Interfaces:**
- None — this task wires existing pieces to real infrastructure; it introduces no new functions other tasks depend on.

- [ ] **Step 1: Finalize `.env.example`**

```bash
# .env.example
DATABASE_URL=
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
TAVILY_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

- [ ] **Step 2: Create Neon, Upstash, and Inngest projects and populate real env vars**

In Vercel's project settings, add every variable from `.env.example` for the Production and Preview environments, pointing `DATABASE_URL` at the Neon production branch and `UPSTASH_REDIS_REST_URL`/`TOKEN` at the Upstash Redis database created for this project.

- [ ] **Step 3: Apply migrations against the production Neon branch**

```bash
DATABASE_URL=<production-url> pnpm dlx drizzle-kit migrate
```

Then run the `CREATE INDEX ... USING hnsw` statement from Task 2 Step 9 against production too.

- [ ] **Step 4: Deploy**

```bash
vercel --prod
```

Expected: build succeeds, deployment URL is live.

- [ ] **Step 5: Connect the Inngest app**

In the Inngest dashboard, add the deployed app at `https://<your-domain>/api/inngest` and confirm `daily-briefing` shows up as a registered function with its `0 8 * * *` schedule.

- [ ] **Step 6: End-to-end smoke test against production**

1. Visit the production URL, sign in with Google, and grant Gmail/Calendar consent.
2. Confirm a row appears in `integration_accounts` (production DB) with a non-null `refresh_token`.
3. Press ⌘K, type "Remind me to ask Rahul about the API tomorrow", confirm a `memories` row is created.
4. Press ⌘K, type "Create a task called test deployment task due tomorrow", confirm it appears on `/tasks`.
5. In the Inngest dashboard, manually trigger the `daily-briefing` function for your user and confirm `/today` renders the generated attention/digest items.

- [ ] **Step 7: Commit the finalized env template and a short deployment checklist**

```markdown
# docs/superpowers/plans/deployment-checklist.md
- [ ] Neon project created, DATABASE_URL set in Vercel (Production + Preview)
- [ ] Upstash Redis created, REST URL/token set in Vercel
- [ ] Inngest app connected to /api/inngest, daily-briefing schedule visible
- [ ] Google Cloud OAuth consent screen configured with gmail.readonly, gmail.compose, calendar.readonly scopes
- [ ] ANTHROPIC_API_KEY, VOYAGE_API_KEY, TAVILY_API_KEY set in Vercel
- [ ] Production migration applied, hnsw index created on memories.embedding
- [ ] Smoke test steps in Task 16 Step 6 all pass
```

```bash
git add .env.example docs/superpowers/plans/deployment-checklist.md
git commit -m "chore: finalize env template and deployment checklist"
```
