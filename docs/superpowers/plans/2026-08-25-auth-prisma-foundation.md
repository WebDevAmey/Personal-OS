# Auth + Prisma Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, standalone hand-rolled auth system (Prisma ORM, JWT sessions, Google OAuth with Gmail/Calendar scope bundling, GitHub OAuth, email/password+OTP via Resend, passkeys, DB-backed auth rate limiting, audit log) that can be verified working end-to-end before the existing app (tasks/memory/command bar/briefing) is cut over to it in a follow-up plan.

**Architecture:** Prisma Client (via `@prisma/adapter-neon`) replaces Drizzle as the ORM. Sessions are stateless JWTs (`jose`) with a `User.sessionVersion` field for instant revocation. `middleware.ts` does a fast, Edge-compatible signature/expiry check only; a Node.js-runtime `getSession()` helper does the authoritative DB-backed check. Every auth flow (password, OTP, Google OAuth, GitHub OAuth, passkeys) is hand-implemented under `app/api/auth/*` — no `next-auth`.

**Tech Stack:** Prisma 7, `@prisma/adapter-neon`, `jose`, `bcrypt`, `@simplewebauthn/server` + `@simplewebauthn/browser`, `resend`, Zod, Vitest.

## Global Constraints

- `middleware.ts` and anything it imports must NEVER import Prisma Client or `bcrypt` — Edge runtime only supports `jose`-based JWT verification there. This is checked explicitly in each task's review, not assumed.
- Every DB query is scoped by the calling user's ID where applicable (carried forward from the existing project convention).
- Passwords: bcrypt, 12 salt rounds. Never log or return a password hash.
- OTP codes: 6-digit numeric, hashed with bcrypt before storage (never store plaintext), 10-minute expiry, max 5 verification attempts before the code is invalidated and a new one must be requested.
- Failed login lockout: after 5 consecutive failed attempts, lock the account for 15 minutes (`User.lockedUntil`).
- JWT payload: `{ sub: userId, sessionVersion, iat, exp }`. Cookie: httpOnly, secure (production), sameSite=lax, 30-day expiry matching the JWT's own expiry.
- Google OAuth scopes (unchanged from the prior Auth.js config — this is load-bearing for the rest of the app): `openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.readonly`, with `access_type=offline&prompt=consent`.
- GitHub OAuth scope: `read:user user:email` (identity only — nothing in this app calls GitHub APIs).
- Never log a raw token, password, OTP code, or full OAuth token-endpoint response body — shape/keys only, per the credential-leak lesson from the prior auth pass.
- Package manager: pnpm.

---

## Task 1: Prisma Setup & Schema

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/prisma.ts`
- Create: `prisma/migrations/` (generated)
- Test: `lib/prisma.test.ts`

**Interfaces:**
- Produces: `prisma` (Prisma Client singleton, default export from `lib/prisma.ts`), and every Prisma model (`User`, `PasskeyCredential`, `WebAuthnChallenge`, `VerificationToken`, `RateLimitAttempt`, `AuthEvent`, `IntegrationAccount`, `Task`, `Memory`, `DailyBriefing`, `AgentRun`, `AgentAction`) available via `prisma.<model>.*`. Every later task in this plan and the follow-up cutover plan imports `prisma` from `@/lib/prisma`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add prisma @prisma/client @prisma/adapter-neon jose bcrypt @simplewebauthn/server @simplewebauthn/browser resend
pnpm add -D @types/bcrypt
pnpm dlx prisma init --datasource-provider postgresql
```

This scaffolds `prisma/schema.prisma` and adds `DATABASE_URL` to `.env` (already present from the Drizzle setup — leave it as-is, same connection string works).

- [ ] **Step 2: Write the full schema**

```prisma
// prisma/schema.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                  String              @id @default(cuid())
  email               String              @unique
  emailVerified       Boolean             @default(false)
  password            String?
  googleId            String?             @unique
  githubId            String?             @unique
  name                String?
  image               String?
  sessionVersion      Int                 @default(0)
  failedLoginAttempts Int                 @default(0)
  lockedUntil         DateTime?
  integrationAccounts IntegrationAccount[]
  tasks               Task[]
  memories            Memory[]
  dailyBriefings      DailyBriefing[]
  agentRuns           AgentRun[]
  passkeyCredentials  PasskeyCredential[]
  authEvents          AuthEvent[]
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
}

model PasskeyCredential {
  id         String    @id
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  publicKey  Bytes
  transports String[]
  counter    Int       @default(0)
  backedUp   Boolean   @default(false)
  deviceType String
  name       String?
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}

model WebAuthnChallenge {
  id        String   @id @default(cuid())
  userId    String?
  challenge String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([expiresAt])
}

enum VerificationType {
  SIGN_UP
  PASSWORD_RESET
}

model VerificationToken {
  id        String            @id @default(cuid())
  email     String
  type      VerificationType
  otpHash   String
  payload   Json?
  attempts  Int               @default(0)
  expiresAt DateTime
  createdAt DateTime          @default(now())

  @@index([email, type])
}

model RateLimitAttempt {
  key         String   @id
  count       Int      @default(1)
  windowStart DateTime @default(now())

  @@index([windowStart])
}

enum AuthEventType {
  SIGN_UP
  LOGIN_SUCCESS
  LOGIN_FAILURE
  ACCOUNT_LOCKED
  LOGOUT
  PASSWORD_RESET_REQUESTED
  PASSWORD_RESET_COMPLETED
  OAUTH_LINKED
  PASSKEY_ADDED
  PASSKEY_REMOVED
}

model AuthEvent {
  id        String        @id @default(cuid())
  type      AuthEventType
  userId    String?
  user      User?         @relation(fields: [userId], references: [id], onDelete: SetNull)
  email     String?
  ip        String?
  userAgent String?
  metadata  Json?
  createdAt DateTime      @default(now())

  @@index([userId])
  @@index([type, createdAt])
  @@index([email])
}

model IntegrationAccount {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider     String
  accessToken  String
  refreshToken String?
  scopes       String
  expiresAt    DateTime?
  createdAt    DateTime  @default(now())

  @@unique([userId, provider])
}

model Task {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title       String
  notes       String?
  dueDate     DateTime?
  status      String    @default("open")
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([userId])
}

model Memory {
  id                          String                      @id @default(cuid())
  userId                      String
  user                        User                        @relation(fields: [userId], references: [id], onDelete: Cascade)
  content                     String
  embedding                   Unsupported("vector(512)")?
  createdAt                   DateTime                    @default(now())

  @@index([userId])
}

model DailyBriefing {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  briefingDate   String
  attentionItems Json
  digestItems    Json
  generatedAt    DateTime @default(now())

  @@index([userId, generatedAt])
}

model AgentRun {
  id          String        @id @default(cuid())
  userId      String
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  input       String
  toolCalls   Json?
  latencyMs   Int?
  tokenCost   Int?
  actions     AgentAction[]
  createdAt   DateTime      @default(now())
}

model AgentAction {
  id             String   @id @default(cuid())
  agentRunId     String
  agentRun       AgentRun @relation(fields: [agentRunId], references: [id], onDelete: Cascade)
  toolName       String
  input          Json?
  output         Json?
  idempotencyKey String   @unique
  status         String
  createdAt      DateTime @default(now())
}
```

- [ ] **Step 3: Generate and apply the initial migration**

```bash
pnpm dlx prisma migrate dev --name init
```

Prisma will create `prisma/migrations/<timestamp>_init/migration.sql`. Open the generated SQL and add, as the very first statement (before any `CREATE TABLE`): `CREATE EXTENSION IF NOT EXISTS vector;` — same manual addition the Drizzle setup needed, since `Unsupported("vector(512)")` tells Prisma to leave the column type alone but doesn't make it install the extension. Re-run `pnpm dlx prisma migrate dev` if it already partially applied, or apply the extension statement by hand via the DB client if the migration already ran — check migration status with `pnpm dlx prisma migrate status` first.

After the migration succeeds, add the HNSW index by hand (same pattern as the Drizzle version — Prisma has no way to express this in schema.prisma):

```bash
pnpm dlx prisma migrate dev --create-only --name add_memories_hnsw_index
```

Edit the generated empty migration file to contain exactly:

```sql
CREATE INDEX IF NOT EXISTS memories_embedding_idx ON "Memory" USING hnsw (embedding vector_cosine_ops);
```

Then apply it: `pnpm dlx prisma migrate dev`.

**This is a clean-slate migration** — the old Drizzle-managed tables (`users`, `accounts`, `sessions`, `verification_tokens`, `tasks`, `memories`, `daily_briefings`, `agent_runs`, `agent_actions`, `integration_accounts`, plus Drizzle's own `__drizzle_migrations` bookkeeping table) still exist in the dev database from the prior pass. Before running `prisma migrate dev`, drop them:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const tables = ['agent_actions','agent_runs','daily_briefings','memories','tasks','integration_accounts','verification_tokens','sessions','accounts','users','drizzle.__drizzle_migrations'];
  for (const t of tables) {
    await sql.query(\`DROP TABLE IF EXISTS \${t.includes('.') ? t : '\"' + t + '\"'} CASCADE\`);
  }
  await sql\`DROP SCHEMA IF EXISTS drizzle CASCADE\`;
  console.log('dropped old Drizzle tables');
})().catch(e => { console.error(e); process.exit(1); });
"
```

(`@neondatabase/serverless` is still installed at this point in the plan — it gets removed in the follow-up cutover plan once nothing references it.)

- [ ] **Step 4: Write the Prisma Client singleton**

```ts
// lib/prisma.ts
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

The `globalForPrisma` caching pattern avoids exhausting connections from Next.js dev server hot-reloads creating a new client on every file change — a well-known Prisma + Next.js requirement, not optional boilerplate.

- [ ] **Step 5: Write and run a smoke test**

```ts
// lib/prisma.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from './prisma';

describe('prisma client', () => {
  it('connects and can run a trivial query', async () => {
    const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
    expect(result[0].ok).toBe(1);
  });

  it('exposes every model this project needs', () => {
    expect(prisma.user).toBeDefined();
    expect(prisma.passkeyCredential).toBeDefined();
    expect(prisma.webAuthnChallenge).toBeDefined();
    expect(prisma.verificationToken).toBeDefined();
    expect(prisma.rateLimitAttempt).toBeDefined();
    expect(prisma.authEvent).toBeDefined();
    expect(prisma.integrationAccount).toBeDefined();
    expect(prisma.task).toBeDefined();
    expect(prisma.memory).toBeDefined();
    expect(prisma.dailyBriefing).toBeDefined();
    expect(prisma.agentRun).toBeDefined();
    expect(prisma.agentAction).toBeDefined();
  });
});
```

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm vitest run lib/prisma.test.ts
```

Expected: both tests pass against the real dev database.

- [ ] **Step 6: Verify pgvector and the HNSW index landed correctly**

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const { PrismaNeon } = require('@prisma/adapter-neon');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
prisma.\$queryRaw\`SELECT indexname FROM pg_indexes WHERE tablename = 'Memory'\`.then(r => { console.log(r); process.exit(0); });
"
```

Expected output includes `memories_embedding_idx`.

- [ ] **Step 7: Commit**

```bash
git add prisma lib/prisma.ts lib/prisma.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add Prisma schema, client, and initial migration (clean-slate)"
```

---

## Task 2: JWT Session Core + Middleware

**Files:**
- Create: `lib/auth/jwt.ts`
- Create: `lib/auth/session.ts`
- Create: `middleware.ts`
- Test: `lib/auth/jwt.test.ts`, `lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma` (Task 1) — `session.ts` only, never `jwt.ts` or `middleware.ts`.
- Produces: `signSessionToken(payload: { userId: string; sessionVersion: number }): Promise<string>`, `verifySessionToken(token: string): Promise<{ userId: string; sessionVersion: number } | null>` (from `lib/auth/jwt.ts` — Edge-safe, no DB access, consumed by both `middleware.ts` and `session.ts`), and `getSession(): Promise<{ userId: string } | null>` (from `lib/auth/session.ts` — Node.js runtime, the authoritative check every page/route uses; consumed by every later task in this plan and the follow-up cutover plan).

- [ ] **Step 1: Write the failing JWT test**

```ts
// lib/auth/jwt.test.ts
import { describe, it, expect } from 'vitest';
import { signSessionToken, verifySessionToken } from './jwt';

describe('session JWT', () => {
  it('round-trips a valid token', async () => {
    const token = await signSessionToken({ userId: 'user-1', sessionVersion: 0 });
    const payload = await verifySessionToken(token);
    expect(payload).toEqual({ userId: 'user-1', sessionVersion: 0 });
  });

  it('returns null for a malformed token', async () => {
    const payload = await verifySessionToken('not-a-real-token');
    expect(payload).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    const { SignJWT } = await import('jose');
    const wrongSecret = new TextEncoder().encode('a-completely-different-secret-value-32bytes');
    const forged = await new SignJWT({ userId: 'user-1', sessionVersion: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(wrongSecret);
    const payload = await verifySessionToken(forged);
    expect(payload).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/jwt.test.ts
```

Expected: FAIL — module `./jwt` not found.

- [ ] **Step 3: Implement the JWT helpers**

```ts
// lib/auth/jwt.ts
import { SignJWT, jwtVerify } from 'jose';

// Edge-safe: no Prisma, no bcrypt, no Node.js-only APIs. middleware.ts imports this directly.

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export interface SessionPayload {
  userId: string;
  sessionVersion: number;
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, sessionVersion: payload.sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId !== 'string' || typeof payload.sessionVersion !== 'number') {
      return null;
    }
    return { userId: payload.userId, sessionVersion: payload.sessionVersion };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/jwt.test.ts
```

Expected: PASS (3 tests). Requires `JWT_SECRET` in `.env.test` — add a line `JWT_SECRET=test-secret-value-at-least-32-bytes-long` to `.env.test` (this is a local test-only value, not a real secret; the real one goes in `.env`/Vercel).

- [ ] **Step 5: Write the failing session test**

```ts
// lib/auth/session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getSession } from './session';
import { signSessionToken } from './jwt';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe('getSession', () => {
  it('returns the userId when the JWT is valid and sessionVersion matches the DB', async () => {
    const token = await signSessionToken({ userId: 'user-1', sessionVersion: 2 });
    const { cookies } = await import('next/headers');
    (cookies as any).mockResolvedValue({ get: () => ({ value: token }) });
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({ sessionVersion: 2 });

    const session = await getSession();
    expect(session).toEqual({ userId: 'user-1' });
  });

  it('returns null when sessionVersion has been bumped (revoked session)', async () => {
    const token = await signSessionToken({ userId: 'user-1', sessionVersion: 1 });
    const { cookies } = await import('next/headers');
    (cookies as any).mockResolvedValue({ get: () => ({ value: token }) });
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({ sessionVersion: 2 });

    const session = await getSession();
    expect(session).toBeNull();
  });

  it('returns null when there is no cookie', async () => {
    const { cookies } = await import('next/headers');
    (cookies as any).mockResolvedValue({ get: () => undefined });

    const session = await getSession();
    expect(session).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/session.test.ts
```

Expected: FAIL — module `./session` not found.

- [ ] **Step 7: Implement `getSession`**

```ts
// lib/auth/session.ts
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { verifySessionToken } from './jwt';

export const SESSION_COOKIE = 'session';

export async function getSession(): Promise<{ userId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { sessionVersion: true } });
  if (!user || user.sessionVersion !== payload.sessionVersion) return null;

  return { userId: payload.userId };
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/session.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 9: Write the middleware**

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/auth/jwt';

const PROTECTED_PREFIXES = ['/today', '/tasks'];

export async function middleware(request: NextRequest) {
  const isProtected = PROTECTED_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get('session')?.value;
  const payload = token ? await verifySessionToken(token) : null;

  if (!payload) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('callbackUrl', request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/today/:path*', '/tasks/:path*'],
};
```

This is deliberately the fast, optimistic check only (signature/expiry via `jose`, no DB call, no `sessionVersion` comparison) — per the design spec, the authoritative revocation check happens in `getSession()` inside each page, not here.

- [ ] **Step 10: Manual verification that middleware doesn't import anything Edge-incompatible**

```bash
grep -rn "from '@/lib/prisma'\|from 'bcrypt'" middleware.ts lib/auth/jwt.ts
```

Expected: no matches. If either file imports Prisma or bcrypt, the design's Edge/Node split is broken — fix before proceeding.

- [ ] **Step 11: Commit**

```bash
git add lib/auth/jwt.ts lib/auth/session.ts lib/auth/jwt.test.ts lib/auth/session.test.ts middleware.ts .env.test
git commit -m "feat: add JWT session core and Edge-compatible middleware"
```

---

## Task 3: Password Hashing & Sign-Up

**Files:**
- Create: `lib/auth/password.ts`
- Create: `app/api/auth/signup/route.ts`
- Test: `lib/auth/password.test.ts`, `app/api/auth/signup/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1).
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>` (from `lib/auth/password.ts`, consumed by Task 5's login route and Task 6's password reset). `POST /api/auth/signup` accepting `{ email, password, name? }`, creating an unverified `User` and triggering an OTP (Task 4 wires the actual OTP send — this task creates the user and calls a stubbed-then-real `sendSignUpOtp` hook).

- [ ] **Step 1: Write the failing password test**

```ts
// lib/auth/password.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes a password and verifies it correctly', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/password.test.ts
```

Expected: FAIL — module `./password` not found.

- [ ] **Step 3: Implement password hashing**

```ts
// lib/auth/password.ts
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/password.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing sign-up route test**

```ts
// app/api/auth/signup/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/auth/otp', () => ({ sendSignUpOtp: vi.fn().mockResolvedValue(undefined) }));

describe('POST /api/auth/signup', () => {
  it('creates an unverified user and sends a sign-up OTP', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: 'user-1', email: 'a@b.com' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { sendSignUpOtp } = await import('@/lib/auth/otp');
    expect(sendSignUpOtp).toHaveBeenCalledWith('a@b.com');
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'a@b.com', emailVerified: false }),
    }));
  });

  it('returns 409 when the email is already registered', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'existing' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('returns 400 for a password shorter than 8 characters', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'short' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/signup/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 7: Implement the sign-up route**

```ts
// app/api/auth/signup/route.ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { sendSignUpOtp } from '@/lib/auth/otp';

const SignUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = SignUpSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: 'An account with this email already exists' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: { email, password: passwordHash, name, emailVerified: false },
  });

  await sendSignUpOtp(email);

  return Response.json({ message: 'Account created. Check your email for a verification code.' });
}
```

Note: this task's test mocks `@/lib/auth/otp`'s `sendSignUpOtp` — that module doesn't exist yet (Task 4 creates it). Since the test mocks it entirely, this task's own test suite doesn't require the real module to exist for tests to pass, but `pnpm build`/`tsc` WILL fail on the missing import until Task 4 lands. This is an accepted, deliberate sequencing within this plan (Task 3 → Task 4 immediately next) — do not stub out a fake `lib/auth/otp.ts` here; Task 4 creates the real one next.

- [ ] **Step 8: Commit**

```bash
git add lib/auth/password.ts lib/auth/password.test.ts app/api/auth/signup
git commit -m "feat: add password hashing and sign-up route (OTP module lands next task)"
```

---

## Task 4: OTP Verification via Resend

**Files:**
- Create: `lib/auth/otp.ts`
- Create: `app/api/auth/verify-otp/route.ts`
- Test: `lib/auth/otp.test.ts`, `app/api/auth/verify-otp/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `hashPassword`/`verifyPassword`-style bcrypt pattern (reuse `bcrypt` directly for OTP hashing, not `lib/auth/password.ts` which is semantically for login passwords).
- Produces: `sendSignUpOtp(email: string): Promise<void>` and `sendPasswordResetOtp(email: string): Promise<void>` (from `lib/auth/otp.ts`; `sendSignUpOtp` consumed by Task 3's signup route, `sendPasswordResetOtp` consumed by Task 6). `POST /api/auth/verify-otp` accepting `{ email, code, type: 'SIGN_UP' | 'PASSWORD_RESET' }`.

- [ ] **Step 1: Write the failing OTP test**

```ts
// lib/auth/otp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSignUpOtp } from './otp';

vi.mock('@/lib/prisma', () => ({
  prisma: { verificationToken: { create: vi.fn() } },
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ data: { id: 'email-1' } }) };
  },
}));

describe('sendSignUpOtp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores a hashed 6-digit OTP with a 10-minute expiry and sends it via Resend', async () => {
    const { prisma } = await import('@/lib/prisma');
    const before = Date.now();

    await sendSignUpOtp('a@b.com');

    expect(prisma.verificationToken.create).toHaveBeenCalledOnce();
    const call = (prisma.verificationToken.create as any).mock.calls[0][0];
    expect(call.data.email).toBe('a@b.com');
    expect(call.data.type).toBe('SIGN_UP');
    expect(call.data.otpHash).not.toMatch(/^\d{6}$/); // must be hashed, not plaintext
    const expiresAt = new Date(call.data.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before + 9 * 60 * 1000);
    expect(expiresAt).toBeLessThan(before + 11 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/otp.test.ts
```

Expected: FAIL — module `./otp` not found.

- [ ] **Step 3: Implement OTP sending**

```ts
// lib/auth/otp.ts
import bcrypt from 'bcrypt';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import type { VerificationType } from '@prisma/client';

const resend = new Resend(process.env.RESEND_API_KEY);
const OTP_TTL_MS = 10 * 60 * 1000;

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function issueOtp(email: string, type: VerificationType, subject: string): Promise<void> {
  const code = generateOtp();
  const otpHash = await bcrypt.hash(code, 10);

  await prisma.verificationToken.create({
    data: { email, type, otpHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  await resend.emails.send({
    from: 'Personal OS <noreply@personal-os.app>',
    to: email,
    subject,
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
  });
}

export async function sendSignUpOtp(email: string): Promise<void> {
  await issueOtp(email, 'SIGN_UP', 'Verify your Personal OS account');
}

export async function sendPasswordResetOtp(email: string): Promise<void> {
  await issueOtp(email, 'PASSWORD_RESET', 'Reset your Personal OS password');
}
```

The `from` address (`noreply@personal-os.app`) requires a verified sending domain in Resend — until a real domain is verified, Resend's sandbox mode only delivers to the account owner's own verified email. Note this in the report; it doesn't block tests (which mock Resend) or block development, only real email delivery to arbitrary addresses in production.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/otp.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Write the failing verify-otp route test**

```ts
// app/api/auth/verify-otp/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';
import bcrypt from 'bcrypt';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationToken: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { update: vi.fn() },
  },
}));

describe('POST /api/auth/verify-otp', () => {
  it('marks the user verified on a correct SIGN_UP code', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { email: 'a@b.com' }, data: { emailVerified: true } });
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'vt-1' } });
  });

  it('rejects an incorrect code and increments attempts', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '000000', type: 'SIGN_UP' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(prisma.verificationToken.update).toHaveBeenCalledWith({ where: { id: 'vt-1' }, data: { attempts: 1 } });
  });

  it('rejects when no matching token exists (expired, wrong email, or already used)', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects when max attempts (5) have already been reached', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 5, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/verify-otp/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 7: Implement the verify-otp route**

```ts
// app/api/auth/verify-otp/route.ts
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';

const VerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  type: z.enum(['SIGN_UP', 'PASSWORD_RESET']),
});

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const parsed = VerifySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { email, code, type } = parsed.data;

  const token = await prisma.verificationToken.findFirst({
    where: { email, type, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!token) {
    return Response.json({ error: 'Code expired or not found. Request a new one.' }, { status: 400 });
  }
  if (token.attempts >= MAX_ATTEMPTS) {
    return Response.json({ error: 'Too many incorrect attempts. Request a new code.' }, { status: 400 });
  }

  const correct = await bcrypt.compare(code, token.otpHash);
  if (!correct) {
    await prisma.verificationToken.update({ where: { id: token.id }, data: { attempts: token.attempts + 1 } });
    return Response.json({ error: 'Incorrect code' }, { status: 400 });
  }

  if (type === 'SIGN_UP') {
    await prisma.user.update({ where: { email }, data: { emailVerified: true } });
  }
  // PASSWORD_RESET: verification alone doesn't reset the password — Task 6's
  // reset-password route re-verifies via this same token record before
  // accepting a new password, and deletes it then. For SIGN_UP, consume now.
  if (type === 'SIGN_UP') {
    await prisma.verificationToken.delete({ where: { id: token.id } });
  }

  return Response.json({ message: 'Verified' });
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run app/api/auth/verify-otp/route.test.ts app/api/auth/signup/route.test.ts
```

Expected: all PASS (Task 3's signup test now resolves its `@/lib/auth/otp` import for real, and its mock still overrides the implementation — both continue to pass; this also confirms `pnpm exec tsc --noEmit` no longer fails on the missing module from Task 3).

- [ ] **Step 9: Commit**

```bash
git add lib/auth/otp.ts lib/auth/otp.test.ts app/api/auth/verify-otp
git commit -m "feat: add OTP generation, email delivery via Resend, and verification"
```

---

## Task 5: Login (Password + Lockout)

**Files:**
- Create: `app/api/auth/login/route.ts`
- Test: `app/api/auth/login/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `verifyPassword` (Task 3), `signSessionToken` (Task 2).
- Produces: `POST /api/auth/login` accepting `{ email, password }`, setting the session cookie on success. No new exported function — this is a terminal route consumed only by the (future, separate) sign-in UI.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/auth/login/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';
import { hashPassword } from '@/lib/auth/password';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

describe('POST /api/auth/login', () => {
  it('sets a session cookie on correct credentials', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^session=/);
  });

  it('rejects an incorrect password and increments failedLoginAttempts', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { failedLoginAttempts: 1 } });
  });

  it('locks the account for 15 minutes after the 5th consecutive failure', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 4, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
    });
    await POST(req);

    const call = (prisma.user.update as any).mock.calls[0][0];
    expect(call.data.failedLoginAttempts).toBe(5);
    expect(new Date(call.data.lockedUntil).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('rejects login while the account is locked, even with the correct password', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(423);
  });

  it('rejects login for an unverified email', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: false,
      sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/login/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement the login route**

```ts
// app/api/auth/login/route.ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth/password';
import { signSessionToken } from '@/lib/auth/jwt';

const LoginSchema = z.object({ email: z.string().email(), password: z.string() });
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const parsed = LoginSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) {
    return Response.json({ error: 'Incorrect email or password' }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return Response.json({ error: 'Account temporarily locked due to failed login attempts' }, { status: 423 });
  }

  const correct = await verifyPassword(password, user.password);
  if (!correct) {
    const failedLoginAttempts = user.failedLoginAttempts + 1;
    const data: { failedLoginAttempts: number; lockedUntil?: Date } = { failedLoginAttempts };
    if (failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
    }
    await prisma.user.update({ where: { id: user.id }, data });
    return Response.json({ error: 'Incorrect email or password' }, { status: 401 });
  }

  if (!user.emailVerified) {
    return Response.json({ error: 'Please verify your email before signing in' }, { status: 403 });
  }

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  }

  const token = await signSessionToken({ userId: user.id, sessionVersion: user.sessionVersion });
  const isProd = process.env.NODE_ENV === 'production';
  const cookie = `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;

  return Response.json({ message: 'Signed in' }, { headers: { 'Set-Cookie': cookie } });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run app/api/auth/login/route.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/login
git commit -m "feat: add password login with lockout and session cookie issuance"
```

---

## Task 6: Password Reset Flow

**Files:**
- Create: `app/api/auth/forgot-password/route.ts`, `app/api/auth/reset-password/route.ts`
- Test: `app/api/auth/forgot-password/route.test.ts`, `app/api/auth/reset-password/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `sendPasswordResetOtp` (Task 4), `hashPassword` (Task 3).
- Produces: `POST /api/auth/forgot-password` (`{ email }`), `POST /api/auth/reset-password` (`{ email, code, newPassword }`). Terminal routes, no exports consumed elsewhere.

- [ ] **Step 1: Write the failing forgot-password test**

```ts
// app/api/auth/forgot-password/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('@/lib/auth/otp', () => ({ sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined) }));

describe('POST /api/auth/forgot-password', () => {
  it('sends a reset OTP when the email exists', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'user-1', email: 'a@b.com' });

    const req = new Request('http://localhost/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'a@b.com' }) });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const { sendPasswordResetOtp } = await import('@/lib/auth/otp');
    expect(sendPasswordResetOtp).toHaveBeenCalledWith('a@b.com');
  });

  it('returns 200 even when the email does not exist (no user enumeration)', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'nobody@b.com' }) });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const { sendPasswordResetOtp } = await import('@/lib/auth/otp');
    expect(sendPasswordResetOtp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/forgot-password/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement forgot-password**

```ts
// app/api/auth/forgot-password/route.ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetOtp } from '@/lib/auth/otp';

const Schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    await sendPasswordResetOtp(parsed.data.email);
  }
  // Always 200, whether or not the account exists — prevents email enumeration.
  return Response.json({ message: 'If that email is registered, a reset code has been sent.' });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run app/api/auth/forgot-password/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing reset-password test**

```ts
// app/api/auth/reset-password/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';
import bcrypt from 'bcrypt';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationToken: { findFirst: vi.fn(), delete: vi.fn() },
    user: { update: vi.fn() },
  },
}));

describe('POST /api/auth/reset-password', () => {
  it('resets the password and bumps sessionVersion (signs out everywhere) on a correct code', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const call = (prisma.user.update as any).mock.calls[0][0];
    expect(call.where).toEqual({ email: 'a@b.com' });
    expect(call.data.password).not.toBe('a brand new passphrase');
    expect(call.data.sessionVersion.increment).toBe(1);
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'vt-1' } });
  });

  it('rejects an incorrect or expired code', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '000000', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/reset-password/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 7: Implement reset-password**

```ts
// app/api/auth/reset-password/route.ts
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';

const Schema = z.object({ email: z.string().email(), code: z.string().length(6), newPassword: z.string().min(8) });

export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { email, code, newPassword } = parsed.data;

  const token = await prisma.verificationToken.findFirst({
    where: { email, type: 'PASSWORD_RESET', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) {
    return Response.json({ error: 'Code expired or not found. Request a new one.' }, { status: 400 });
  }

  const correct = await bcrypt.compare(code, token.otpHash);
  if (!correct) {
    return Response.json({ error: 'Incorrect code' }, { status: 400 });
  }

  const newHash = await hashPassword(newPassword);
  // sessionVersion.increment: signs the user out of every existing session —
  // a password reset is exactly the case getSession()'s revocation check exists for.
  await prisma.user.update({ where: { email }, data: { password: newHash, sessionVersion: { increment: 1 } } });
  await prisma.verificationToken.delete({ where: { id: token.id } });

  return Response.json({ message: 'Password reset. Please sign in again.' });
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run app/api/auth/reset-password/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add app/api/auth/forgot-password app/api/auth/reset-password
git commit -m "feat: add password reset flow with session invalidation"
```

---

## Task 7: Google OAuth (Hand-Rolled, with Integration Token Persistence)

**Files:**
- Create: `lib/auth/google-oauth.ts`
- Create: `lib/auth/cookies.ts` (shared `readCookie` helper — also used by Task 8's GitHub callback)
- Create: `app/api/auth/google/route.ts`, `app/api/auth/google/callback/route.ts`
- Create: `lib/integrations/google/refresh-token.ts` (ported from the Drizzle version)
- Test: `lib/auth/google-oauth.test.ts`, `app/api/auth/google/callback/route.test.ts`, `lib/integrations/google/refresh-token.test.ts`, `lib/auth/cookies.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `signSessionToken` (Task 2).
- Produces: `buildGoogleAuthUrl(state: string): string`, `exchangeGoogleCode(code: string): Promise<GoogleTokenResponse>` (from `lib/auth/google-oauth.ts`); `readCookie(req: Request, name: string): string | null` (from `lib/auth/cookies.ts`, consumed here and by Task 8); `getFreshAccessToken(userId: string): Promise<string>` plus `NoIntegrationAccountError`/`TokenRefreshFailedError` (from `lib/integrations/google/refresh-token.ts` — same public shape as the Drizzle-era version, consumed by the follow-up cutover plan's command route and Inngest job port).

- [ ] **Step 1: Write the failing OAuth URL/exchange test**

```ts
// lib/auth/google-oauth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGoogleAuthUrl, exchangeGoogleCode } from './google-oauth';

describe('buildGoogleAuthUrl', () => {
  it('requests the Gmail and Calendar scopes alongside identity, with offline access', () => {
    const url = new URL(buildGoogleAuthUrl('state-123'));
    const scope = url.searchParams.get('scope');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.compose');
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(scope).toContain('openid');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-123');
  });
});

describe('exchangeGoogleCode', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = originalFetch; });

  it('posts the code to Google\'s token endpoint and returns the parsed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok', refresh_token: 'refresh', expires_in: 3600, id_token: 'idtok' }),
    }) as any;

    const result = await exchangeGoogleCode('auth-code-123');
    expect(result.access_token).toBe('tok');
    expect(global.fetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/google-oauth.test.ts
```

Expected: FAIL — module `./google-oauth` not found.

- [ ] **Step 3: Implement the OAuth URL builder and code exchange**

```ts
// lib/auth/google-oauth.ts
const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export function buildGoogleAuthUrl(state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token: string;
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status}`);
  }
  return res.json();
}

export function decodeGoogleIdToken(idToken: string): { sub: string; email: string; name?: string; picture?: string } {
  const payload = idToken.split('.')[1];
  const json = Buffer.from(payload, 'base64url').toString('utf-8');
  return JSON.parse(json);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/google-oauth.test.ts
```

Expected: PASS (2 tests). Requires `GOOGLE_CLIENT_ID`/`NEXT_PUBLIC_APP_URL` in `.env.test` — add `GOOGLE_CLIENT_ID=test-client-id` and `NEXT_PUBLIC_APP_URL=http://localhost:3000` to `.env.test`.

- [ ] **Step 5: Write the failing Google callback route test**

```ts
// app/api/auth/google/callback/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }, integrationAccount: { upsert: vi.fn() } },
}));
vi.mock('@/lib/auth/google-oauth', () => ({
  exchangeGoogleCode: vi.fn(),
  decodeGoogleIdToken: vi.fn(),
}));

function requestWithStateCookie(state: string, cookieState: string | null) {
  const headers = new Headers();
  if (cookieState !== null) headers.set('cookie', `google_oauth_state=${cookieState}`);
  return new Request(`http://localhost/api/auth/google/callback?code=abc&state=${state}`, { headers });
}

describe('GET /api/auth/google/callback', () => {
  it('creates a new user by googleId, persists integration tokens, and sets a session cookie', async () => {
    const { exchangeGoogleCode, decodeGoogleIdToken } = await import('@/lib/auth/google-oauth');
    (exchangeGoogleCode as any).mockResolvedValue({
      access_token: 'access-xyz', refresh_token: 'refresh-xyz', expires_in: 3600, id_token: 'idtok',
    });
    (decodeGoogleIdToken as any).mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com', name: 'A B' });

    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(307); // redirect to /today
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
    expect(prisma.integrationAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_provider: { userId: 'user-1', provider: 'google' } },
      create: expect.objectContaining({ accessToken: 'access-xyz', refreshToken: 'refresh-xyz' }),
    }));
  });

  it('links to an existing user with the same email instead of creating a duplicate', async () => {
    const { exchangeGoogleCode, decodeGoogleIdToken } = await import('@/lib/auth/google-oauth');
    (exchangeGoogleCode as any).mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    (decodeGoogleIdToken as any).mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com' });

    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'existing-user', googleId: null, sessionVersion: 0 });

    await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing-user' },
      data: expect.objectContaining({ googleId: 'google-sub-1' }),
    }));
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects when the callback state does not match the state cookie (CSRF)', async () => {
    const res = await GET(requestWithStateCookie('attacker-supplied-state', 'original-state'));
    expect(res.status).toBe(400);
    const { prisma } = await import('@/lib/prisma');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when there is no state cookie at all', async () => {
    const res = await GET(requestWithStateCookie('xyz', null));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/google/callback/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 6b: Write the failing cookie-reader test**

```ts
// lib/auth/cookies.test.ts
import { describe, it, expect } from 'vitest';
import { readCookie } from './cookies';

describe('readCookie', () => {
  it('reads a named cookie value from the Cookie header', () => {
    const req = new Request('http://localhost/', { headers: { cookie: 'foo=bar; google_oauth_state=abc123' } });
    expect(readCookie(req, 'google_oauth_state')).toBe('abc123');
  });

  it('returns null when the cookie is not present', () => {
    const req = new Request('http://localhost/', { headers: { cookie: 'foo=bar' } });
    expect(readCookie(req, 'google_oauth_state')).toBeNull();
  });

  it('returns null when there is no Cookie header at all', () => {
    const req = new Request('http://localhost/');
    expect(readCookie(req, 'google_oauth_state')).toBeNull();
  });
});
```

Run `pnpm vitest run lib/auth/cookies.test.ts` — expect FAIL (module not found). Implement:

```ts
// lib/auth/cookies.ts
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const match = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
```

Run again — expect PASS (3 tests).

- [ ] **Step 7: Implement the Google routes**

```ts
// app/api/auth/google/route.ts
import { buildGoogleAuthUrl } from '@/lib/auth/google-oauth';
import { randomBytes } from 'node:crypto';

export async function GET() {
  const state = randomBytes(16).toString('hex');
  const url = buildGoogleAuthUrl(state);
  // The state cookie is compared against the callback's ?state= param
  // (see app/api/auth/google/callback/route.ts) to prevent CSRF — an
  // attacker tricking a victim into completing OAuth with the attacker's
  // own authorization code. 5-minute expiry is enough for a normal consent
  // flow; httpOnly since JS never needs to read it.
  const stateCookie = `google_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`;
  return new Response(null, { status: 307, headers: { Location: url, 'Set-Cookie': stateCookie } });
}
```

```ts
// app/api/auth/google/callback/route.ts
import { exchangeGoogleCode, decodeGoogleIdToken } from '@/lib/auth/google-oauth';
import { prisma } from '@/lib/prisma';
import { signSessionToken } from '@/lib/auth/jwt';
import { readCookie } from '@/lib/auth/cookies';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return Response.json({ error: 'Missing code' }, { status: 400 });

  const cookieState = readCookie(req, 'google_oauth_state');
  if (!cookieState || !state || cookieState !== state) {
    return Response.json({ error: 'Invalid OAuth state — possible CSRF, please try signing in again' }, { status: 400 });
  }

  const tokens = await exchangeGoogleCode(code);
  const claims = decodeGoogleIdToken(tokens.id_token);

  let user = await prisma.user.findUnique({ where: { email: claims.email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: claims.email, googleId: claims.sub, name: claims.name, image: claims.picture, emailVerified: true },
    });
  } else if (!user.googleId) {
    user = await prisma.user.update({ where: { id: user.id }, data: { googleId: claims.sub } });
  }

  await prisma.integrationAccount.upsert({
    where: { userId_provider: { userId: user.id, provider: 'google' } },
    create: {
      userId: user.id, provider: 'google', accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token, scopes: 'gmail.readonly gmail.compose calendar.readonly',
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
    update: {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  const sessionToken = await signSessionToken({ userId: user.id, sessionVersion: user.sessionVersion });
  const isProd = process.env.NODE_ENV === 'production';
  const cookie = `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;

  return new Response(null, { status: 307, headers: { Location: '/today', 'Set-Cookie': cookie } });
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run app/api/auth/google/callback/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 9: Port `getFreshAccessToken` to Prisma**

Write the failing test first:

```ts
// lib/integrations/google/refresh-token.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFreshAccessToken, NoIntegrationAccountError, TokenRefreshFailedError } from './refresh-token';

vi.mock('@/lib/prisma', () => ({
  prisma: { integrationAccount: { findUnique: vi.fn(), update: vi.fn() } },
}));

const originalFetch = global.fetch;

describe('getFreshAccessToken', () => {
  beforeEach(() => { global.fetch = originalFetch; vi.clearAllMocks(); });

  it('returns the existing token without a network call when still fresh', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.integrationAccount.findUnique as any).mockResolvedValue({
      accessToken: 'still-fresh', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() + 60 * 60 * 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn();

    const token = await getFreshAccessToken('user-1');
    expect(token).toBe('still-fresh');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes and persists a new token when expired', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.integrationAccount.findUnique as any).mockResolvedValue({
      accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'fresh-access-token', expires_in: 3600 }) }) as any;

    const token = await getFreshAccessToken('user-1');
    expect(token).toBe('fresh-access-token');
    expect(prisma.integrationAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_provider: { userId: 'user-1', provider: 'google' } },
      data: expect.objectContaining({ accessToken: 'fresh-access-token' }),
    }));
  });

  it('throws NoIntegrationAccountError when no row exists', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.integrationAccount.findUnique as any).mockResolvedValue(null);
    await expect(getFreshAccessToken('user-1')).rejects.toThrow(NoIntegrationAccountError);
  });

  it('throws TokenRefreshFailedError when Google rejects the refresh', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.integrationAccount.findUnique as any).mockResolvedValue({
      accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }) as any;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
  });

  it('throws TokenRefreshFailedError (not an Invalid Date crash) when expires_in is missing, without logging token values', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.integrationAccount.findUnique as any).mockResolvedValue({
      accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'secret-value-should-not-appear-in-error' }) }) as any;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    try {
      await getFreshAccessToken('user-1');
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('secret-value-should-not-appear-in-error');
    }
  });
});
```

Run it to confirm RED, then implement:

```ts
// lib/integrations/google/refresh-token.ts
import { prisma } from '@/lib/prisma';

export class NoIntegrationAccountError extends Error {
  constructor(userId: string) {
    super(`No Google integration account found for user ${userId}`);
    this.name = 'NoIntegrationAccountError';
  }
}

export class TokenRefreshFailedError extends Error {
  constructor(userId: string, message: string, cause?: unknown) {
    super(`Failed to refresh Google token for user ${userId}: ${message}`);
    this.name = 'TokenRefreshFailedError';
    this.cause = cause;
  }
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getFreshAccessToken(userId: string): Promise<string> {
  const account = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: 'google' } },
  });
  if (!account) throw new NoIntegrationAccountError(userId);

  const stillFresh = account.expiresAt && account.expiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();
  if (stillFresh) return account.accessToken;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: account.refreshToken!,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new TokenRefreshFailedError(userId, `Google returned ${res.status}`, { status: res.status, body });
  }

  const data = await res.json();
  if (typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || typeof data.access_token !== 'string') {
    throw new TokenRefreshFailedError(userId, `Google token endpoint response missing valid fields (got keys: ${Object.keys(data).join(',')})`);
  }
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new TokenRefreshFailedError(userId, 'Computed an invalid expiry from Google\'s response');
  }

  await prisma.integrationAccount.update({
    where: { userId_provider: { userId, provider: 'google' } },
    data: {
      accessToken: data.access_token,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      expiresAt,
    },
  });

  return data.access_token;
}
```

- [ ] **Step 10: Run test to verify it passes**

```bash
pnpm vitest run lib/integrations/google/refresh-token.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 11: Commit**

```bash
git add lib/auth/google-oauth.ts lib/auth/google-oauth.test.ts lib/auth/cookies.ts lib/auth/cookies.test.ts app/api/auth/google lib/integrations/google .env.test
git commit -m "feat: add hand-rolled Google OAuth with Gmail/Calendar scope bundling, CSRF state check, and token refresh"
```

---

## Task 8: GitHub OAuth (Hand-Rolled, Identity Only)

**Files:**
- Create: `lib/auth/github-oauth.ts`
- Create: `app/api/auth/github/route.ts`, `app/api/auth/github/callback/route.ts`
- Test: `lib/auth/github-oauth.test.ts`, `app/api/auth/github/callback/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `signSessionToken` (Task 2), `readCookie` (Task 7 — same CSRF state-cookie pattern, different cookie name).
- Produces: nothing consumed elsewhere — terminal auth routes, same shape as Task 7 but without `IntegrationAccount` persistence (identity-only).

- [ ] **Step 1: Write the failing test**

```ts
// lib/auth/github-oauth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGithubAuthUrl, exchangeGithubCode, fetchGithubUser } from './github-oauth';

describe('buildGithubAuthUrl', () => {
  it('requests read:user and user:email scopes', () => {
    const url = new URL(buildGithubAuthUrl('state-123'));
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toBe('state-123');
  });
});

describe('exchangeGithubCode / fetchGithubUser', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = originalFetch; });

  it('exchanges the code and fetches the GitHub user profile', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'gh-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 12345, email: 'a@b.com', name: 'A B', avatar_url: 'https://...' }) }) as any;

    const token = await exchangeGithubCode('code-123');
    const profile = await fetchGithubUser(token);

    expect(profile.id).toBe(12345);
    expect(profile.email).toBe('a@b.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/github-oauth.test.ts
```

Expected: FAIL — module `./github-oauth` not found.

- [ ] **Step 3: Implement**

```ts
// lib/auth/github-oauth.ts
export function buildGithubAuthUrl(state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID!);
  url.searchParams.set('redirect_uri', `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/github/callback`);
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGithubCode(code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/github/callback`,
    }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

export interface GithubUser {
  id: number;
  email: string;
  name?: string;
  avatar_url?: string;
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub user fetch failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/github-oauth.test.ts
```

Expected: PASS (2 tests). Requires `GITHUB_CLIENT_ID` in `.env.test`.

- [ ] **Step 5: Write the failing callback route test**

```ts
// app/api/auth/github/callback/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/auth/github-oauth', () => ({
  exchangeGithubCode: vi.fn(),
  fetchGithubUser: vi.fn(),
}));

function requestWithStateCookie(state: string, cookieState: string | null) {
  const headers = new Headers();
  if (cookieState !== null) headers.set('cookie', `github_oauth_state=${cookieState}`);
  return new Request(`http://localhost/api/auth/github/callback?code=abc&state=${state}`, { headers });
}

describe('GET /api/auth/github/callback', () => {
  it('creates a new user by githubId and sets a session cookie', async () => {
    const { exchangeGithubCode, fetchGithubUser } = await import('@/lib/auth/github-oauth');
    (exchangeGithubCode as any).mockResolvedValue('gh-token');
    (fetchGithubUser as any).mockResolvedValue({ id: 999, email: 'a@b.com', name: 'A B' });

    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(307);
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ githubId: '999', email: 'a@b.com' }),
    }));
  });

  it('rejects when the callback state does not match the state cookie (CSRF)', async () => {
    const res = await GET(requestWithStateCookie('attacker-state', 'original-state'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/github/callback/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 7: Implement the GitHub routes**

```ts
// app/api/auth/github/route.ts
import { buildGithubAuthUrl } from '@/lib/auth/github-oauth';
import { randomBytes } from 'node:crypto';

export async function GET() {
  const state = randomBytes(16).toString('hex');
  const stateCookie = `github_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`;
  return new Response(null, { status: 307, headers: { Location: buildGithubAuthUrl(state), 'Set-Cookie': stateCookie } });
}
```

```ts
// app/api/auth/github/callback/route.ts
import { exchangeGithubCode, fetchGithubUser } from '@/lib/auth/github-oauth';
import { prisma } from '@/lib/prisma';
import { signSessionToken } from '@/lib/auth/jwt';
import { readCookie } from '@/lib/auth/cookies';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return Response.json({ error: 'Missing code' }, { status: 400 });

  const cookieState = readCookie(req, 'github_oauth_state');
  if (!cookieState || !state || cookieState !== state) {
    return Response.json({ error: 'Invalid OAuth state — possible CSRF, please try signing in again' }, { status: 400 });
  }

  const accessToken = await exchangeGithubCode(code);
  const profile = await fetchGithubUser(accessToken);

  let user = await prisma.user.findUnique({ where: { email: profile.email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: profile.email, githubId: String(profile.id), name: profile.name, image: profile.avatar_url, emailVerified: true },
    });
  } else if (!user.githubId) {
    user = await prisma.user.update({ where: { id: user.id }, data: { githubId: String(profile.id) } });
  }

  const sessionToken = await signSessionToken({ userId: user.id, sessionVersion: user.sessionVersion });
  const isProd = process.env.NODE_ENV === 'production';
  const cookie = `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;

  return new Response(null, { status: 307, headers: { Location: '/today', 'Set-Cookie': cookie } });
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run app/api/auth/github/callback/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add lib/auth/github-oauth.ts lib/auth/github-oauth.test.ts app/api/auth/github .env.test
git commit -m "feat: add hand-rolled GitHub OAuth (identity only)"
```

---

## Task 9: Passkey Registration

**Files:**
- Create: `lib/auth/webauthn.ts`
- Create: `app/api/auth/passkey/register/options/route.ts`, `app/api/auth/passkey/register/verify/route.ts`
- Test: `lib/auth/webauthn.test.ts`, `app/api/auth/passkey/register/verify/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `getSession` (Task 2 — passkey registration requires an existing signed-in user, unlike login).
- Produces: `RP_NAME`, `RP_ID`, `ORIGIN` constants and helper wrappers around `@simplewebauthn/server` (from `lib/auth/webauthn.ts`, consumed by both registration and Task 10's authentication routes).

- [ ] **Step 1: Write the failing webauthn config test**

```ts
// lib/auth/webauthn.test.ts
import { describe, it, expect } from 'vitest';
import { RP_ID, RP_NAME, ORIGIN } from './webauthn';

describe('webauthn config', () => {
  it('derives RP_ID from NEXT_PUBLIC_APP_URL without a protocol or port', () => {
    expect(RP_ID).toBe('localhost');
    expect(ORIGIN).toBe('http://localhost:3000');
    expect(RP_NAME).toBe('Personal OS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/webauthn.test.ts
```

Expected: FAIL — module `./webauthn` not found.

- [ ] **Step 3: Implement the config**

```ts
// lib/auth/webauthn.ts
export const RP_NAME = 'Personal OS';
export const ORIGIN = process.env.NEXT_PUBLIC_APP_URL!;
export const RP_ID = new URL(ORIGIN).hostname;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/webauthn.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Write the failing registration-verify route test**

```ts
// app/api/auth/passkey/register/verify/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { webAuthnChallenge: { findFirst: vi.fn(), delete: vi.fn() }, passkeyCredential: { create: vi.fn() } },
}));
vi.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: vi.fn(),
}));

describe('POST /api/auth/passkey/register/verify', () => {
  it('stores a new passkey credential on successful verification', async () => {
    const { getSession } = await import('@/lib/auth/session');
    (getSession as any).mockResolvedValue({ userId: 'user-1' });

    const { prisma } = await import('@/lib/prisma');
    (prisma.webAuthnChallenge.findFirst as any).mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });

    const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
    (verifyRegistrationResponse as any).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
        credentialBackedUp: true,
        credentialDeviceType: 'singleDevice',
      },
    });

    const req = new Request('http://localhost/api/auth/passkey/register/verify', {
      method: 'POST', body: JSON.stringify({ response: {}, name: 'My laptop' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prisma.passkeyCredential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', id: 'cred-1', name: 'My laptop' }),
    }));
  });

  it('returns 401 when there is no session', async () => {
    const { getSession } = await import('@/lib/auth/session');
    (getSession as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/passkey/register/verify', { method: 'POST', body: JSON.stringify({}) });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/passkey/register/verify/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 7: Implement the registration routes**

```ts
// app/api/auth/passkey/register/options/route.ts
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { RP_NAME, RP_ID } from '@/lib/auth/webauthn';

export async function POST() {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.userId }, include: { passkeyCredentials: true } });
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email,
    excludeCredentials: user.passkeyCredentials.map((c) => ({ id: c.id, transports: c.transports as any })),
  });

  await prisma.webAuthnChallenge.create({ data: { userId: user.id, challenge: options.challenge, expiresAt: new Date(Date.now() + 5 * 60 * 1000) } });

  return Response.json(options);
}
```

```ts
// app/api/auth/passkey/register/verify/route.ts
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { RP_ID, ORIGIN } from '@/lib/auth/webauthn';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { response, name } = await req.json();

  const challengeRecord = await prisma.webAuthnChallenge.findFirst({
    where: { userId: session.userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!challengeRecord) return Response.json({ error: 'Challenge expired or not found' }, { status: 400 });

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: 'Passkey verification failed' }, { status: 400 });
  }

  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
  await prisma.passkeyCredential.create({
    data: {
      id: credential.id,
      userId: session.userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      backedUp: credentialBackedUp,
      deviceType: credentialDeviceType,
      name,
    },
  });

  await prisma.webAuthnChallenge.delete({ where: { id: challengeRecord.id } });

  return Response.json({ message: 'Passkey registered' });
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run app/api/auth/passkey/register/verify/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add lib/auth/webauthn.ts lib/auth/webauthn.test.ts app/api/auth/passkey/register
git commit -m "feat: add passkey registration ceremony"
```

---

## Task 10: Passkey Authentication

**Files:**
- Create: `app/api/auth/passkey/login/options/route.ts`, `app/api/auth/passkey/login/verify/route.ts`
- Test: `app/api/auth/passkey/login/verify/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `signSessionToken` (Task 2), `RP_ID`/`ORIGIN` (Task 9).
- Produces: terminal login routes, no exports consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/auth/passkey/login/verify/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    webAuthnChallenge: { findFirst: vi.fn(), delete: vi.fn() },
    passkeyCredential: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('@simplewebauthn/server', () => ({ verifyAuthenticationResponse: vi.fn() }));

describe('POST /api/auth/passkey/login/verify', () => {
  it('sets a session cookie and bumps the credential counter on successful verification', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.webAuthnChallenge.findFirst as any).mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });
    (prisma.passkeyCredential.findUnique as any).mockResolvedValue({
      id: 'cred-1', userId: 'user-1', publicKey: Buffer.from([1, 2, 3]), counter: 5, transports: ['internal'],
    });
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
    (verifyAuthenticationResponse as any).mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });

    const req = new Request('http://localhost/api/auth/passkey/login/verify', {
      method: 'POST', body: JSON.stringify({ response: { id: 'cred-1' } }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^session=/);
    expect(prisma.passkeyCredential.update).toHaveBeenCalledWith({ where: { id: 'cred-1' }, data: { counter: 6, lastUsedAt: expect.any(Date) } });
  });

  it('rejects when the credential id is unknown', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.webAuthnChallenge.findFirst as any).mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });
    (prisma.passkeyCredential.findUnique as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/passkey/login/verify', {
      method: 'POST', body: JSON.stringify({ response: { id: 'unknown-cred' } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run app/api/auth/passkey/login/verify/route.test.ts
```

Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement**

```ts
// app/api/auth/passkey/login/options/route.ts
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { RP_ID } from '@/lib/auth/webauthn';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' });
  await prisma.webAuthnChallenge.create({ data: { challenge: options.challenge, expiresAt: new Date(Date.now() + 5 * 60 * 1000) } });
  return Response.json(options);
}
```

```ts
// app/api/auth/passkey/login/verify/route.ts
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/prisma';
import { RP_ID, ORIGIN } from '@/lib/auth/webauthn';
import { signSessionToken } from '@/lib/auth/jwt';

export async function POST(req: Request) {
  const { response } = await req.json();

  const credential = await prisma.passkeyCredential.findUnique({ where: { id: response.id } });
  if (!credential) return Response.json({ error: 'Unknown passkey' }, { status: 400 });

  const challengeRecord = await prisma.webAuthnChallenge.findFirst({
    where: { expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!challengeRecord) return Response.json({ error: 'Challenge expired or not found' }, { status: 400 });

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: { id: credential.id, publicKey: new Uint8Array(credential.publicKey), counter: credential.counter, transports: credential.transports as any },
  });

  if (!verification.verified) return Response.json({ error: 'Passkey verification failed' }, { status: 400 });

  await prisma.passkeyCredential.update({ where: { id: credential.id }, data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() } });
  await prisma.webAuthnChallenge.delete({ where: { id: challengeRecord.id } });

  const user = await prisma.user.findUnique({ where: { id: credential.userId } });
  const sessionToken = await signSessionToken({ userId: credential.userId, sessionVersion: user!.sessionVersion });
  const isProd = process.env.NODE_ENV === 'production';
  const cookie = `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;

  return Response.json({ message: 'Signed in' }, { headers: { 'Set-Cookie': cookie } });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run app/api/auth/passkey/login/verify/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/passkey/login
git commit -m "feat: add passkey authentication ceremony"
```

---

## Task 11: Auth Rate Limiting + Audit Log

**Files:**
- Create: `lib/auth/rate-limit.ts`, `lib/auth/audit.ts`
- Modify: `app/api/auth/login/route.ts`, `app/api/auth/signup/route.ts` (wire both in)
- Test: `lib/auth/rate-limit.test.ts`, `lib/auth/audit.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1).
- Produces: `checkAuthRateLimit(key: string, maxAttempts: number, windowMs: number): Promise<{ allowed: boolean }>` (from `lib/auth/rate-limit.ts` — DB-backed, distinct from the existing Upstash-based `lib/rate-limit.ts` used for AI/integration calls; consumed by login/signup here and, in the follow-up plan, nowhere else) and `logAuthEvent(event: { type: AuthEventType; userId?: string; email?: string; metadata?: object }): Promise<void>` (from `lib/auth/audit.ts`, consumed by every auth route — this task wires it into login/signup as the pattern, later routes follow the same pattern but aren't required to be retrofitted by this task).

- [ ] **Step 1: Write the failing rate-limit test**

```ts
// lib/auth/rate-limit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { checkAuthRateLimit } from './rate-limit';

vi.mock('@/lib/prisma', () => ({
  prisma: { rateLimitAttempt: { findUnique: vi.fn(), upsert: vi.fn() } },
}));

describe('checkAuthRateLimit', () => {
  it('allows the first attempt in a fresh window', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.rateLimitAttempt.findUnique as any).mockResolvedValue(null);

    const result = await checkAuthRateLimit('login:a@b.com', 5, 15 * 60 * 1000);
    expect(result.allowed).toBe(true);
    expect(prisma.rateLimitAttempt.upsert).toHaveBeenCalled();
  });

  it('denies once the max attempts within the window is reached', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.rateLimitAttempt.findUnique as any).mockResolvedValue({ key: 'login:a@b.com', count: 5, windowStart: new Date() });

    const result = await checkAuthRateLimit('login:a@b.com', 5, 15 * 60 * 1000);
    expect(result.allowed).toBe(false);
  });

  it('resets the count once the window has elapsed', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.rateLimitAttempt.findUnique as any).mockResolvedValue({ key: 'login:a@b.com', count: 5, windowStart: new Date(Date.now() - 20 * 60 * 1000) });

    const result = await checkAuthRateLimit('login:a@b.com', 5, 15 * 60 * 1000);
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/rate-limit.test.ts
```

Expected: FAIL — module `./rate-limit` not found.

- [ ] **Step 3: Implement**

```ts
// lib/auth/rate-limit.ts
import { prisma } from '@/lib/prisma';

export async function checkAuthRateLimit(key: string, maxAttempts: number, windowMs: number): Promise<{ allowed: boolean }> {
  const existing = await prisma.rateLimitAttempt.findUnique({ where: { key } });
  const now = new Date();

  if (!existing || now.getTime() - existing.windowStart.getTime() > windowMs) {
    await prisma.rateLimitAttempt.upsert({
      where: { key },
      create: { key, count: 1, windowStart: now },
      update: { count: 1, windowStart: now },
    });
    return { allowed: true };
  }

  if (existing.count >= maxAttempts) {
    return { allowed: false };
  }

  await prisma.rateLimitAttempt.upsert({
    where: { key },
    create: { key, count: 1, windowStart: now },
    update: { count: { increment: 1 } },
  });
  return { allowed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/rate-limit.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing audit-log test**

```ts
// lib/auth/audit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { logAuthEvent } from './audit';

vi.mock('@/lib/prisma', () => ({ prisma: { authEvent: { create: vi.fn() } } }));

describe('logAuthEvent', () => {
  it('writes an AuthEvent row with the given fields', async () => {
    const { prisma } = await import('@/lib/prisma');
    await logAuthEvent({ type: 'LOGIN_SUCCESS', userId: 'user-1', email: 'a@b.com' });
    expect(prisma.authEvent.create).toHaveBeenCalledWith({ data: { type: 'LOGIN_SUCCESS', userId: 'user-1', email: 'a@b.com', metadata: undefined } });
  });

  it('never throws even if the write fails (audit logging must not break the auth flow)', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.authEvent.create as any).mockRejectedValue(new Error('db down'));
    await expect(logAuthEvent({ type: 'LOGIN_FAILURE', email: 'a@b.com' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run lib/auth/audit.test.ts
```

Expected: FAIL — module `./audit` not found.

- [ ] **Step 7: Implement**

```ts
// lib/auth/audit.ts
import { prisma } from '@/lib/prisma';
import type { AuthEventType } from '@prisma/client';

export async function logAuthEvent(event: { type: AuthEventType; userId?: string; email?: string; metadata?: object }): Promise<void> {
  try {
    await prisma.authEvent.create({ data: { type: event.type, userId: event.userId, email: event.email, metadata: event.metadata } });
  } catch (err) {
    // Audit logging is best-effort — a DB blip here must never fail a real
    // login/signup attempt. Log locally so it's not silently invisible.
    console.error('[audit] failed to record auth event', event.type, err);
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run lib/auth/audit.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 9: Wire both into login and signup**

In `app/api/auth/login/route.ts`, add near the top of `POST` (after parsing, before the DB lookup):

```ts
import { checkAuthRateLimit } from '@/lib/auth/rate-limit';
import { logAuthEvent } from '@/lib/auth/audit';

// after parsing `email`/`password`:
const { allowed } = await checkAuthRateLimit(`login:${email}`, 10, 15 * 60 * 1000);
if (!allowed) {
  return Response.json({ error: 'Too many login attempts. Try again later.' }, { status: 429 });
}
```

And call `logAuthEvent({ type: 'LOGIN_SUCCESS', userId: user.id, email })` right before returning the success response, and `logAuthEvent({ type: 'LOGIN_FAILURE', email })` in the incorrect-password branch, and `logAuthEvent({ type: 'ACCOUNT_LOCKED', userId: user.id, email })` when `lockedUntil` gets set.

In `app/api/auth/signup/route.ts`, add the same rate-limit check keyed `signup:${email}` (limit 5 per hour) before creating the user, and `logAuthEvent({ type: 'SIGN_UP', userId, email })` after creation.

Update both routes' existing tests to mock `@/lib/auth/rate-limit` (returning `{ allowed: true }`) and `@/lib/auth/audit` (no-op), and add one new test per route confirming a 429 when `checkAuthRateLimit` returns `{ allowed: false }`.

- [ ] **Step 10: Run the full auth test suite**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)"
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

All must pass.

- [ ] **Step 11: Commit**

```bash
git add lib/auth/rate-limit.ts lib/auth/audit.ts lib/auth/rate-limit.test.ts lib/auth/audit.test.ts app/api/auth/login app/api/auth/signup
git commit -m "feat: add DB-backed auth rate limiting and audit logging, wired into login/signup"
```

---

## Task 12: Minimal Functional Auth Pages

**Files:**
- Create: `app/sign-in/page.tsx`, `app/sign-up/page.tsx`, `app/verify-otp/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`

**Interfaces:**
- Consumes: nothing new — plain client-side forms calling the routes built in Tasks 3, 5, 6, 7, 8, 9, 10 via `fetch`.
- Produces: nothing consumed by other tasks. These are intentionally bare-functional, not styled — the project owner is separately building the app's visual design (landing page, etc.) and will restyle these to match.

**Note on scope:** No tests for these — they're thin client-side forms with no logic of their own beyond calling already-tested API routes. Verify via `pnpm build` succeeding and a manual code read, consistent with how this project has treated other pure-UI-wiring tasks (e.g. the original Tasks 13/15).

- [ ] **Step 1: Sign-in page (password + Google + GitHub + passkey entry points)**

```tsx
// app/sign-in/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (res.ok) { router.push('/today'); return; }
    const body = await res.json();
    setError(body.error ?? 'Sign in failed');
  }

  async function handlePasskeyLogin() {
    setError(null);
    const optionsRes = await fetch('/api/auth/passkey/login/options', { method: 'POST' });
    const options = await optionsRes.json();
    try {
      const response = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/passkey/login/verify', { method: 'POST', body: JSON.stringify({ response }) });
      if (verifyRes.ok) { router.push('/today'); return; }
      setError('Passkey sign-in failed');
    } catch {
      setError('Passkey sign-in was cancelled or failed');
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Sign in</h1>
      <form onSubmit={handlePasswordLogin} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit">Sign in</button>
      </form>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <a href="/api/auth/google">Continue with Google</a>
        <a href="/api/auth/github">Continue with GitHub</a>
        <button onClick={handlePasskeyLogin} type="button">Sign in with a passkey</button>
      </div>
      <p style={{ marginTop: 16 }}>
        <a href="/forgot-password">Forgot password?</a> · <a href="/sign-up">Create an account</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Sign-up page**

```tsx
// app/sign-up/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (res.ok) { router.push(`/verify-otp?email=${encodeURIComponent(email)}&type=SIGN_UP`); return; }
    const body = await res.json();
    setError(body.error ?? 'Sign up failed');
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Create an account</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <button type="submit">Create account</button>
      </form>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <p style={{ marginTop: 16 }}><a href="/sign-in">Already have an account?</a></p>
    </main>
  );
}
```

- [ ] **Step 3: Verify-OTP page**

```tsx
// app/verify-otp/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function VerifyOtpPage() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const type = params.get('type') ?? 'SIGN_UP';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code, type }) });
    if (res.ok) {
      router.push(type === 'PASSWORD_RESET' ? `/reset-password?email=${encodeURIComponent(email)}&code=${code}` : '/sign-in');
      return;
    }
    const body = await res.json();
    setError(body.error ?? 'Verification failed');
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Enter verification code</h1>
      <p>We sent a 6-digit code to {email}.</p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input type="text" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
        <button type="submit">Verify</button>
      </form>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
    </main>
  );
}
```

- [ ] **Step 4: Forgot-password and reset-password pages**

```tsx
// app/forgot-password/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    router.push(`/verify-otp?email=${encodeURIComponent(email)}&type=PASSWORD_RESET`);
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Reset your password</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button type="submit">Send reset code</button>
      </form>
    </main>
  );
}
```

```tsx
// app/reset-password/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const [code, setCode] = useState(params.get('code') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) });
    if (res.ok) { router.push('/sign-in'); return; }
    const body = await res.json();
    setError(body.error ?? 'Reset failed');
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Set a new password</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input type="text" inputMode="numeric" maxLength={6} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} required />
        <input type="password" placeholder="New password (min 8 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        <button type="submit">Reset password</button>
      </form>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
    </main>
  );
}
```

- [ ] **Step 5: Verify the build**

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)"
pnpm build
```

Expected: succeeds, all five new routes appear in the route list.

- [ ] **Step 6: Commit**

```bash
git add app/sign-in app/sign-up app/verify-otp app/forgot-password app/reset-password
git commit -m "feat: add minimal functional auth pages (restyle target for project owner's design pass)"
```

---

## Task 13: Env Template Update

**Files:**
- Modify: `.env.example`

**Interfaces:**
- None — documentation/template only.

- [ ] **Step 1: Update `.env.example` for the new auth system**

Remove `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (Auth.js-specific). Add:

```bash
# JWT session signing secret. Generate with: openssl rand -base64 33
JWT_SECRET=

# Public URL of the app (used to build OAuth redirect URIs and WebAuthn RP_ID/origin).
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Google OAuth (hand-rolled — see lib/auth/google-oauth.ts). From Google Cloud
# Console > APIs & Services > Credentials. Same Gmail/Calendar API + scope
# setup as before: enable Gmail API and Calendar API on the project, and
# request gmail.readonly, gmail.compose, calendar.readonly on the consent screen.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# GitHub OAuth (hand-rolled — see lib/auth/github-oauth.ts). From GitHub >
# Settings > Developer settings > OAuth Apps. Callback URL:
# {NEXT_PUBLIC_APP_URL}/api/auth/github/callback
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Resend (OTP emails for sign-up verification and password reset — see
# lib/auth/otp.ts). Get a key from resend.com. The `from` address in
# lib/auth/otp.ts needs a verified sending domain in Resend before it can
# deliver to arbitrary recipients (sandbox mode only reaches the account
# owner's own address).
RESEND_API_KEY=
```

Keep every other existing variable (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `TAVILY_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) — those are unaffected by this migration.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: update env template for the new hand-rolled auth system"
```
