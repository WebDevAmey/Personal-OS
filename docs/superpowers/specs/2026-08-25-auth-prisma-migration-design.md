# Auth + ORM Migration: Auth.js/Drizzle → Hand-Rolled JWT/Prisma

**Status:** Approved for implementation
**Date:** 2026-08-25
**Scope of this document:** Full design for replacing this project's auth system and ORM. Supersedes the auth-related portions of `docs/superpowers/specs/2026-08-24-personal-os-v1-design.md` (§5 stack choice of Drizzle, §10 Auth.js-based auth). All other V1 decisions in that document (product scope, AI orchestration, capability adapters, reliability posture) are unchanged.

## 1. Why

The project owner wants the auth system modeled on [github.com/atharvaarbat/next-auth](https://github.com/atharvaarbat/next-auth) — a hand-rolled JWT-session auth template (Prisma, `jose`, `bcrypt`, `@simplewebauthn`) supporting email/password+OTP, Google OAuth, GitHub OAuth, and passkeys. Adopting it means adopting its ORM (Prisma) too — running two ORMs against one schema long-term isn't a real option, so this is a full swap of the persistence layer, not just the auth layer.

## 2. Goals / Non-goals

**Goals:**
- Full parity with the reference template's auth methods: email/password + OTP (via Resend), Google OAuth, GitHub OAuth, WebAuthn passkeys.
- Preserve the one thing the template doesn't do that this app requires: Google sign-in must still request Gmail/Calendar API scopes and persist refresh-able access tokens (`IntegrationAccount`), not just identity. The template's Google login is identity-only — this is the one deliberate divergence from copying it verbatim.
- Every existing app feature (tasks, memory, command bar, daily briefing, rate limiting) keeps working, now backed by Prisma instead of Drizzle.
- Carry forward the hardening already done in the Drizzle version: idempotent tool calls, user-scoped queries, token refresh, no credential leakage into logs/audit trails.

**Non-goals (this pass):**
- No data migration from the old Drizzle-managed tables — clean-slate schema recreation (no real users exist yet; pre-launch).
- No change to product scope, AI orchestration design, capability adapters (Gmail/Calendar/Tavily), or the Inngest job's shape — only their data-access calls change.
- CSP/security-header middleware from the template is included (it's in the same `middleware.ts` file the session check needs anyway) but not expanded beyond what the template does.

## 3. Architecture

```
                    Browser
                       │
                       ▼
     middleware.ts (Edge runtime, fast path)
   verifies JWT signature/expiry only (jose, no DB)
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   /api/auth/*   /(app)/today   /(app)/tasks
   (hand-rolled    /tasks        pages — each calls
    OAuth, OTP,                  getSession() (Node.js
    passkeys)                    runtime, authoritative:
          │                      re-verifies JWT +
          │                      checks sessionVersion)
          ▼                             │
   lib/prisma.ts (Prisma Client, Neon driver adapter)
                       │
                       ▼
      Neon Postgres (same database, new schema)
```

**Stack changes:**
- ORM: Drizzle → **Prisma 7**, via `@prisma/adapter-neon` (Neon's serverless driver adapter — same pooled-connection-string approach as before, now through Prisma's adapter interface instead of `drizzle-orm/neon-http`).
- Sessions: Auth.js database sessions → **stateless JWT cookies** (`jose`), with a `User.sessionVersion` integer compared on every verification — bumping it invalidates all existing sessions instantly (password change, "sign out everywhere", account lock).
- Auth surface: `next-auth`/`@auth/drizzle-adapter` removed entirely. Every auth flow (Google OAuth, GitHub OAuth, email/password, OTP, passkeys) is hand-implemented under `app/api/auth/*`.
- New dependencies: `prisma`, `@prisma/client`, `@prisma/adapter-neon`, `jose`, `bcrypt`, `@simplewebauthn/server`, `@simplewebauthn/browser`, `resend`. Removed: `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless` (Prisma's Neon adapter replaces its direct use), `next-auth`, `@auth/drizzle-adapter`.
- Route protection moves from `app/(app)/layout.tsx` (added in the previous pass, calling Auth.js's `auth()`) to `middleware.ts` at the project root, checking the JWT cookie directly — faster (runs before any React render) and matches the template's pattern. `app/(app)/layout.tsx` is removed.

## 4. Data Model (Prisma)

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
}

model User {
  id                  String              @id @default(cuid())
  email               String              @unique
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

model PasskeyCredential { /* id, userId, publicKey Bytes, transports String[], counter, backedUp, deviceType, name?, lastUsedAt?, createdAt — verbatim from the template */ }
model WebAuthnChallenge { /* id, userId?, challenge, expiresAt, createdAt — verbatim */ }

enum VerificationType { SIGN_UP PASSWORD_RESET }
model VerificationToken { /* id, email, type, otpHash, payload Json?, attempts, expiresAt, createdAt — verbatim */ }

model RateLimitAttempt { /* key @id, count, windowStart — verbatim; used ONLY for auth-endpoint abuse (login/signup/OTP), separate from lib/rate-limit.ts's Upstash-based AI/integration limiting, which is unchanged */ }

enum AuthEventType { SIGN_UP LOGIN_SUCCESS LOGIN_FAILURE ACCOUNT_LOCKED LOGOUT PASSWORD_RESET_REQUESTED PASSWORD_RESET_COMPLETED OAUTH_LINKED PASSKEY_ADDED PASSKEY_REMOVED }
model AuthEvent { /* id, type, userId?, email?, ip?, userAgent?, metadata Json?, createdAt — verbatim */ }

// App-specific, ported from Drizzle 1:1 (column meaning unchanged):
model IntegrationAccount {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider     String   // "google" (github/etc. would be separate rows if ever added — this table is API-token storage, distinct from User.googleId/githubId which are identity-only)
  accessToken  String
  refreshToken String?
  scopes       String
  expiresAt    DateTime?
  createdAt    DateTime @default(now())
  @@unique([userId, provider])
}

model Task { /* id, userId, title, notes?, dueDate?, status, completedAt?, createdAt, updatedAt — unchanged from Drizzle shape */ }

model Memory {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  content   String
  embedding Unsupported("vector(512)")?
  createdAt DateTime @default(now())
  // HNSW index (memories_embedding_idx) applied via a raw-SQL migration step,
  // same as the Drizzle version — Prisma has no native vector type either.
}

model DailyBriefing { /* id, userId, briefingDate, attentionItems Json, digestItems Json, generatedAt — unchanged */ }
model AgentRun { /* id, userId, input, toolCalls Json?, latencyMs?, tokenCost?, createdAt — unchanged */ }
model AgentAction { /* id, agentRunId, toolName, input Json?, output Json?, idempotencyKey @unique, status, createdAt — unchanged */ }
```

Full field-level detail for the elided models matches the template verbatim (auth models) or the existing Drizzle schema verbatim (app models) — the implementation plan will spell out every field, this section establishes the shape and rationale.

## 5. Auth Flows

**Google OAuth** (`/api/auth/google` → redirect; `/api/auth/google/callback` → exchange): builds the authorization URL by hand with `scope=openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.readonly`, `access_type=offline`, `prompt=consent` — identical scope set to the current Auth.js config, preserving the "one OAuth flow = login + Gmail/Calendar access" property from the original spec. On callback: exchange code for tokens, decode the id_token, upsert `User` by `googleId` (link to an existing email-matched user if one exists rather than duplicate), issue a JWT session cookie, upsert `IntegrationAccount` with the returned tokens/scopes — replacing `persistIntegrationAccount` + Auth.js's `events.signIn`, same logic, hand-written. `getFreshAccessToken` (from the previous pass's fix) carries over essentially unchanged — same expiry-check-and-refresh logic, Prisma calls instead of Drizzle.

**GitHub OAuth**: same shape, identity-only (no API scopes needed — nothing in this app calls GitHub APIs), upsert by `githubId`.

**Email/password + OTP**: sign-up creates a `User` with a bcrypt-hashed password and issues a `SIGN_UP` OTP via Resend; account isn't usable until the OTP is verified. Login checks the hash, increments `failedLoginAttempts` on failure, sets `lockedUntil` past a threshold (matching the template's fields). Password reset issues a `PASSWORD_RESET` OTP.

**Passkeys**: registration and authentication ceremonies via `@simplewebauthn/server`, challenges stored in `WebAuthnChallenge` (short TTL), credentials in `PasskeyCredential`.

**Sessions**: JWT payload `{ sub: userId, sessionVersion }`, httpOnly + secure + sameSite=lax cookie. Verification is split across two layers, not done once in middleware — `jose`'s edge-compatible primitives make signature/expiry checking safe in `middleware.ts`, but Prisma Client's DB access is unreliable in the Edge runtime middleware runs in, so the `sessionVersion` check (the part that actually needs the database) can't live there:
- **`middleware.ts` (Edge, fast path):** verifies the JWT's signature and expiry only (`jose`, no DB call). Missing/malformed/expired → redirect to sign-in immediately. This is an optimistic check — it does not yet know if the session was revoked.
- **Server Components/Route Handlers (Node.js runtime, authoritative path):** a shared `getSession()` helper re-verifies the JWT and additionally compares its embedded `sessionVersion` against `User.sessionVersion` in the database via Prisma. A mismatch (password changed, signed out everywhere, account locked since the JWT was issued) is treated as unauthenticated here, even though middleware let the request through.

This is the standard split for edge-middleware + DB-backed sessions: middleware keeps obviously-invalid requests from ever reaching a page; the authoritative revocation check happens where Prisma actually works. Every page/route that reads `session.user.id` must call `getSession()`, not just trust that middleware already validated it.

## 6. Migration / Cutover Strategy

Single cutover, not a parallel-run period:
1. Author the full Prisma schema, generate and apply an initial migration against the dev Neon database, dropping the old Drizzle-managed auth tables (`users`, `accounts`, `sessions`, `verification_tokens` in their Auth.js shape) and recreating the app tables (`tasks`, `memories`, `daily_briefings`, `agent_runs`, `agent_actions`, `integration_accounts`) under Prisma's naming/migration system. The HNSW index is reapplied via the same raw-SQL-in-migration approach used before.
2. Port each domain module (`lib/tasks/queries.ts`, `lib/memory/queries.ts`, `lib/ai/idempotency.ts`, `lib/integrations/google/refresh-token.ts`) to Prisma calls, one at a time, each with its existing test suite rewritten against a mocked Prisma client instead of a mocked Drizzle `db`.
3. Build the new auth surface (`middleware.ts`, `app/api/auth/*`, `lib/auth/*` session/JWT helpers) as new code, replacing `auth.ts` and the Auth.js route handler.
4. Rewire every consumer (`lib/ai/orchestrator.ts`, `app/api/command/route.ts`, `app/(app)/today/page.tsx`, `app/(app)/tasks/page.tsx`, `inngest/daily-briefing.ts`) from `auth()`/Drizzle `db` to the new session helper/Prisma client.
5. Delete `db/` (Drizzle schema/client/migrations), `auth.ts`, `app/api/auth/[...nextauth]/route.ts`, `lib/auth/persist-integration-account.ts`, `app/(app)/layout.tsx`'s Auth.js guard, and the now-unused dependencies.
6. Update `.env.example` and the deployment checklist for the new variable set (`JWT_SECRET` or similar replaces `AUTH_SECRET`'s Auth.js-specific meaning; `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `RESEND_API_KEY` — exact names finalized in the implementation plan).

No feature flag, no dual-write period — pre-launch with no real users makes a clean cutover the simpler and correct choice over a staged migration.

## 7. Testing Strategy

Same bar as the rest of this project: TDD, tests assert real mutated values, DB-backed tests run against the real dev database with the namespaced-fixture-ID convention established during the original build (to survive parallel test-file execution). Prisma's mockability (via `vi.mock('@/lib/prisma', ...)` on a singleton client export) mirrors how Drizzle's `db` was mocked, so the existing test patterns transfer directly — this is a rewrite of test bodies, not a rethink of test strategy.

## 8. Risks

- **Passkeys and OTP/email flows are new surface area with real security stakes** (credential storage, WebAuthn ceremony correctness, brute-force lockout) — get proportionally more scrutiny in review than a typical CRUD port.
- **`Unsupported("vector(512)")` in Prisma** means the `embedding` column is invisible to Prisma Client's query builder (same limitation Drizzle's custom type had) — all vector search stays in raw SQL (`prisma.$queryRaw`), which is a direct carry-over of the existing pattern, not new risk.
- **Google OAuth token refresh logic must not regress** — this was a Critical finding fixed in the previous pass; the port must preserve `getFreshAccessToken`'s exact semantics (5-minute margin, error-type discrimination, no credential values in logs), not just its shape.
- **Edge/Node.js runtime boundary must be respected.** `bcrypt` (native bindings) and Prisma Client must never be imported into any module `middleware.ts` pulls in — only `jose` is edge-safe there. Password verification, OTP hashing, and all Prisma calls stay in Route Handlers/Server Components (Node.js runtime). Getting this wrong doesn't fail loudly in development the same way it fails on Vercel's actual Edge deployment, so this needs an explicit check during implementation, not just a "it built fine locally" assumption.
