# 01 — Current-State Audit (baseline, 2026-10-21)

Baseline of branch `personal-os-v1` at commit `4bb0885` before the Personal OS
V1 rebuild. It should be read alongside `docs/12-decisions.md` (ADRs). Every
claim carries one of two labels:

- **[V]** VERIFIED: the code or migration was read, or a command was run, on 2026-10-21.
- **[A]** ASSUMPTION: inferred, not confirmed. This includes anything about the
  remote Neon database, which cannot be reached from this environment.

Commands run for this audit: `git log`, `git branch -a`, `git status`,
`vitest run --reporter=json` (no env vars set), `psql` read-only against the
local `aios_test` database, plus reads of every file under `app/`, `lib/`,
`db/`, `prisma/`, `inngest/`, `components/` (non-UI), and the config files.

---

## 1. Branch and history summary

| Item | Finding | |
|---|---|---|
| Current branch | `personal-os-v1`. Others: `main`, `backup/main-original`, `backup/personal-os-v1-original`, `origin/main`, `origin/personal-os-v1` | [V] |
| Commits on branch | 68, all authored by Amey Tarmale (history rewritten per ADR-016) | [V] |
| Uncommitted | `docs/08-implementation-plan.md`, `docs/11-progress.md`, `docs/12-decisions.md` (untracked, planning phase) | [V] |

The history has five phases [V]:

1. **Spec and plan** (`638959f`, `d4157a7`): V1 design built on Drizzle and Auth.js.
2. **V1 build** (`e92546e` … `0010bcf`, 16 plan tasks): scaffold, Drizzle schema and
   migrations, Auth.js Google, tasks and memory libraries, Gmail/Calendar/Tavily adapters, tool
   registry, idempotency wrapper, orchestrator, Upstash rate limits, command bar,
   `/tasks`, Inngest briefing, `/today`, env template and deployment checklist.
3. **Hardening** (`1054b1f` … `1b4658c`): token refresh, keeping tokens out of
   Inngest step state, `generateObject` for the briefing, no embedding leaks,
   per-user failure isolation in the cron, the Auth.js guard on `/today` and `/tasks`, sign-out.
4. **Auth and Prisma migration** (`fcfa92a` spec, `de43b51` plan, then `2b32ed5` … `20af228`):
   plan tasks 1–9 were done (Prisma schema, JWT, password, OTP, login lockout, reset,
   Google OAuth, GitHub OAuth, passkey registration), each followed by review-fix commits.
5. **WIP snapshot** (`4bb0885`): passkey *authentication* routes (plan task 10,
   untested), auth pages (task 12), and the landing hero. Plan task 11 (auth rate
   limiting and audit) and the follow-up "cutover plan" were never started.

---

## 2. Stack and versions

Versions are resolved from `pnpm-lock.yaml` [V].

| Area | Package | Version | Status |
|---|---|---|---|
| Framework | `next` | 15.5.23 (`--turbopack` dev/build) | keep |
| UI runtime | `react` / `react-dom` | 19.1.0 | keep |
| Language | `typescript` | 5.9.3 | keep |
| Styling | `tailwindcss` | 4.3.3 | keep |
| Primitives | `@base-ui/react` (shadcn `components.json`) | 1.7.0 | keep (ADR-013) |
| Palette | `cmdk` | 1.1.1 | keep |
| Motion | `motion` 13.1.1 **and** `framer-motion` 13.1.1 | duplicate | drop `framer-motion` (ADR-013); used by `components/ui/animated-tooltip.tsx` and `components/hero/streak-widget.tsx` |
| ORM (new) | `prisma`, `@prisma/client`, `@prisma/adapter-neon` | 7.9.1 | keep; add `@prisma/adapter-pg` + `pg` (ADR-003) |
| ORM (legacy) | `drizzle-orm` 0.45.2, `drizzle-kit` 0.31.10, `@neondatabase/serverless` 1.1.0 | legacy | remove after cutover (ADR-002). `@neondatabase/serverless` may remain as a transitive dependency of the Neon adapter [A] |
| Auth (new) | `jose` 6.2.10, `bcrypt` 6.0.0, `@simplewebauthn/server` 13.3.2, `@simplewebauthn/browser` 13.3.0 | | keep |
| Auth (legacy) | `next-auth` 5.0.0-beta.32, `@auth/drizzle-adapter` 1.11.3 | legacy | remove (ADR-002) |
| AI | `ai` 7.0.77, `@ai-sdk/anthropic` 4.0.41 | | keep (ADR-009). Model id `claude-sonnet-5` is hard-coded in 2 places |
| Embeddings | Voyage `voyage-3-lite` via raw `fetch` (`lib/ai/embeddings.ts`) | 512-dim | keep |
| Jobs | `inngest` | 4.18.1 | keep |
| Rate limit | `@upstash/ratelimit` 2.0.8, `@upstash/redis` 1.38.2 | | keep for AI and integrations (ADR-012) |
| Email | `resend` | 6.22.1 | keep |
| Google | `googleapis` | 176.0.0 | keep |
| Validation | `zod` | 4.4.3 | keep |
| Tests | `vitest` 4.1.11, jsdom, Testing Library | | keep |

Generated Prisma client output goes to `lib/generated/prisma`, which is gitignored and produced by `postinstall: prisma generate` [V].
`pnpm db:migrate` still points at `drizzle-kit migrate` [V]. It must be repointed to Prisma or removed.

---

## 3. Route map

### 3.1 Pages (`app/`)

The middleware matcher is only `['/today/:path*', '/tasks/:path*']` (`middleware.ts`) [V].

| Route | File | Identity source | Data source | Middleware | Status |
|---|---|---|---|---|---|
| `/` | `app/page.tsx` → `components/hero/hero.tsx` | none | none | no | Landing page. CTA links go to **`/api/auth/signin` (Auth.js)**, not `/sign-in` [V] |
| `/sign-in` | `app/sign-in/page.tsx` | n/a | `POST /api/auth/login`, Google/GitHub redirects | no | Works. `router.push(callbackUrl)` with an unvalidated `callbackUrl` query param (see §7). No passkey button [V] |
| `/sign-up` | `app/sign-up/page.tsx` | n/a | `POST /api/auth/signup` | no | Works |
| `/verify-otp` | `app/verify-otp/page.tsx` | n/a | `POST /api/auth/verify-otp` | no | Works. No "resend code" path exists anywhere [V] |
| `/forgot-password` | `app/forgot-password/page.tsx` | n/a | `POST /api/auth/forgot-password` | no | Works |
| `/reset-password` | `app/reset-password/page.tsx` | n/a | `POST /api/auth/reset-password` | no | Works |
| `/today` | `app/(app)/today/page.tsx` | **Auth.js `auth()`** (page) **and** JWT (middleware) | **Drizzle** `daily_briefings` | yes | Broken for JWT users (see §6.3) |
| `/tasks` | `app/(app)/tasks/page.tsx` | **Auth.js `auth()`** | **Drizzle** via `lib/tasks/queries.ts` | yes | Broken for JWT users |
| `(app)` layout | `app/(app)/layout.tsx` | **Auth.js `auth()`**, redirects to `/api/auth/signin`. Sign-out uses Auth.js `signOut()` | none | n/a | Legacy guard. The migration spec §3 says to delete it [V] |
| root layout | `app/layout.tsx` | none | none | n/a | Mounts `<CommandBar/>` on **every** page, including the landing and auth pages [V] |

### 3.2 API routes (`app/api/`)

| Route | Method | File | Identity | ORM | Tests | Status |
|---|---|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | `app/api/auth/[...nextauth]/route.ts` | Auth.js | Drizzle adapter | 0 | Legacy. Serves `/api/auth/signin`, `/api/auth/callback/google`, `/api/auth/signout` |
| `/api/auth/signup` | POST | `signup/route.ts` | none | Prisma | 4 | Works. 409 on an existing email reveals that the account exists |
| `/api/auth/verify-otp` | POST | `verify-otp/route.ts` | none | Prisma | 6 | Works. Atomic attempt reservation |
| `/api/auth/login` | POST | `login/route.ts` | issues JWT | Prisma | 9 | Works. Lockout after 5 failures for 15 min. No IP rate limit, no AuthEvent |
| `/api/auth/forgot-password` | POST | `forgot-password/route.ts` | none | Prisma | 5 | Works. Uses `after()` for timing parity, 60 s reissue throttle |
| `/api/auth/reset-password` | POST | `reset-password/route.ts` | none | Prisma | 6 | Works. Bumps `sessionVersion` |
| `/api/auth/google` | GET | `google/route.ts` | none | n/a | 3 | Works. State cookie, no PKCE |
| `/api/auth/google/callback` | GET | `google/callback/route.ts` | issues JWT | Prisma | 11 | Works. Writes `IntegrationAccount` (plaintext tokens) |
| `/api/auth/github` | GET | `github/route.ts` | none | n/a | 3 | Works |
| `/api/auth/github/callback` | GET | `github/callback/route.ts` | issues JWT | Prisma | 10 | Works. Verified-email selection |
| `/api/auth/passkey/register/options` | POST | `passkey/register/options/route.ts` | `getSession()` | Prisma | 7 (file fails to load without `NEXT_PUBLIC_APP_URL`) | Works |
| `/api/auth/passkey/register/verify` | POST | `passkey/register/verify/route.ts` | `getSession()` | Prisma | 12 (same) | Works |
| `/api/auth/passkey/auth/options` | POST | `passkey/auth/options/route.ts` | none | Prisma | **0** | **Unsafe** (§7) |
| `/api/auth/passkey/auth/verify` | POST | `passkey/auth/verify/route.ts` | issues JWT | Prisma | **0** | **Unsafe** (§7) |
| `/api/command` | POST | `app/api/command/route.ts` | **Auth.js `auth()`** | Drizzle (tasks, memory, agent tables) **+ Prisma** (`IntegrationAccount` via `getFreshAccessToken`) | 6 | Broken end to end (§6.3). Not covered by middleware |
| `/api/inngest` | GET/POST/PUT | `app/api/inngest/route.ts` | Inngest signing | n/a | 0 | Serves `dailyBriefingFn` only |

Missing routes [V]: logout for JWT sessions, "sign out everywhere", resend OTP,
passkey management (list/rename/remove), `/api/command/confirm`, settings and
preferences, tasks REST/server actions (the UI has no create/edit/complete), health.

---

## 4. Module inventory

| Module | Files | ORM / identity | State |
|---|---|---|---|
| `lib/auth/jwt.ts` | sign/verify HS256, 30 d, claims `{userId, sessionVersion}` | Edge-safe | Works. The plan said `sub`, the code uses a `userId` claim (cosmetic) [V] |
| `lib/auth/session.ts` | `getSession()`: JWT plus a DB `sessionVersion` check | Prisma | Works. Used only by passkey registration so far [V] |
| `lib/auth/cookies.ts`, `password.ts`, `otp.ts` | cookie read, bcrypt(12), OTP (`randomInt`, bcrypt(10), 10 min TTL, Resend) | Prisma | Works. `otp.ts` constructs `new Resend()` at module scope |
| `lib/auth/google-oauth.ts`, `github-oauth.ts` | URL build, code exchange, id_token decode, GitHub verified email | none | Works. `decodeGoogleIdToken` does not verify signature, `iss`, `aud` or `exp` (acceptable for a back-channel token response, but should be hardened) |
| `lib/auth/webauthn.ts` | RP id/origin, `userIdToUserHandle` | none | Throws at import without `NEXT_PUBLIC_APP_URL` |
| `lib/auth/persist-integration-account.ts` | Drizzle upsert of `integration_accounts` | **Drizzle** | Legacy. Called only by `auth.ts` |
| `auth.ts` | Auth.js with the Drizzle adapter, `events.signIn` → persist tokens | **Drizzle / Auth.js** | Legacy |
| `lib/prisma.ts` | `PrismaNeon` singleton | Prisma | Hard-wired to the Neon adapter (ADR-003 changes this) |
| `lib/tasks/queries.ts` | create/update/complete/delete(soft)/search | **Drizzle** | Ownership is checked by a pre-read and then repeated in the `where`. No version, no history |
| `lib/memory/queries.ts` | `saveMemory`, `searchMemory` (raw SQL `<=>`) | **Drizzle** | Works on Drizzle tables |
| `lib/ai/embeddings.ts` | Voyage fetch | none | Error message includes the response body (no secrets expected) |
| `lib/ai/idempotency.ts` | `withIdempotency` (lookup, run, insert, race handling) | **Drizzle** | Semantics are flawed (§7: the key is per run) |
| `lib/ai/tools/index.ts` | 11 tools, Zod, mutating tools wrapped in idempotency | via domain libraries | The model calls mutating tools directly with model-invented ISO dates |
| `lib/ai/orchestrator.ts` | `generateText` with `stepCountIs(5)`, writes to `agent_runs` | **Drizzle** | Hard-coded model, no clientRequestId |
| `lib/integrations/google/refresh-token.ts` | `getFreshAccessToken`, typed errors | **Prisma** | Works. Reads plaintext tokens. `TokenRefreshFailedError.cause` includes Google's error body |
| `lib/integrations/{gmail,calendar,web}/client.ts`, `types.ts` | capability adapters | none | Works. Gmail `search` does an N+1 `messages.get` with no `maxResults`. `read()` returns only the snippet as the body |
| `lib/rate-limit.ts` | Upstash `ai` 30/min, `integration` 60/min | Upstash | `Redis.fromEnv()` runs at module scope. No dev/test fallback. The `integration` bucket is never called [V: grep] |
| `inngest/daily-briefing.ts` | cron `0 8 * * *` UTC, loops users, `generateObject` | **Drizzle** (user list, insert) + Prisma (token) | Mixed. No run status, no per-day uniqueness, no grounding |
| `db/**`, `drizzle.config.ts` | Drizzle schema, client, 3 migrations | **Drizzle** | Legacy |
| `prisma/**`, `prisma.config.ts` | schema plus 2 migrations | Prisma | Canonical from `20260825055217_init` (ADR-004) |
| `components/command-bar/command-bar.tsx` | ⌘K dialog, Web Speech, POST `/api/command` | n/a | No `Content-Type`, no clientRequestId, no error state for non-2xx, auto-submits the voice transcript without letting the user edit it (conflicts with ADR-015) |
| `components/briefing/briefing-view.tsx`, `components/tasks/task-list.tsx` | display | types from **`@/db/schema`** | Coupled to Drizzle types |
| `components/hero/*`, `components/footer`, `components/ui/*` | landing and shadcn primitives | n/a | Orphans with no importer [V: grep]: `components/motion/command-palette.tsx` (and its hooks `lib/hooks/*`, `lib/presence-gate.tsx`), `components/ui/stat-card.tsx`, `components/ui/section-separator.tsx`, `components/hero/streak-widget.tsx`, `components/ui/m-random-letter-swap-1.tsx` |

---

## 5. What works, what is incomplete

**Works (unit-tested, mocked DB)** [V]: password sign-up and OTP verification, login
with lockout, password reset with session revocation, Google and GitHub OAuth with
CSRF state and verified-email checks, passkey registration, the JWT core, Google
token refresh, the Gmail/Calendar/Tavily adapters, and the idempotency race handling
(against the Drizzle mock).

**Incomplete** [V]:
- The cutover of tasks, memory, idempotency, orchestrator, briefing, pages and the
  command route to Prisma and `getSession()` was never done (it was a separate "follow-up plan" that does not exist).
- Plan task 10 (passkey authentication) has code but no tests and has security defects (§7).
- Plan task 11 (DB-backed auth rate limit, `AuthEvent` writes) was not started. Both tables exist but are unused (grep for `authEvent` / `rateLimitAttempt` outside tests returns nothing).
- There is no logout route for JWT sessions. The only sign-out is Auth.js `signOut()` in the `(app)` layout.
- There is no tasks UI beyond a read-only list of `open` tasks. There are no projects, reminders, preferences or settings.
- The `.env.example` still lists the Auth.js vars (`AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`) next to the new `GOOGLE_CLIENT_ID/SECRET`.

### 5.1 Duplicated: Drizzle schema vs Prisma schema (field by field)

Sources: `db/schema/*.ts` plus `db/migrations/0000…0002` versus `prisma/schema.prisma` plus
`prisma/migrations/20260825055217_init` and `20260825055921_add_memories_hnsw_index` [V].

General differences [V]:
- **Table names never collide.** Drizzle uses lowercase plural snake_case (`tasks`); Prisma uses quoted PascalCase singular (`"Task"`) with no `@@map`. Both sets can coexist in `public`.
- **Columns**: Drizzle uses snake_case, Prisma uses camelCase.
- **IDs**: Drizzle app tables use `uuid DEFAULT gen_random_uuid()`. Prisma uses `TEXT` with a cuid generated by the client.
- **Timestamps**: Drizzle uses `timestamp` (without tz, precision 6). Prisma uses `TIMESTAMP(3)` (without tz).
- **FKs**: Drizzle uses `ON UPDATE no action`. Prisma uses `ON UPDATE CASCADE`. Both cascade on delete.

| Entity | Field | Drizzle (`db/schema`, migration 0000/0001) | Prisma (`schema.prisma`, init) | Difference |
|---|---|---|---|---|
| **User** | table | `users` | `"User"` | |
| | id | `text` PK (Auth.js-generated) | `TEXT` cuid | different namespaces. The same person gets different ids |
| | email | `text NOT NULL UNIQUE` | `TEXT NOT NULL`, unique index | same |
| | emailVerified | `email_verified timestamp NULL` | `"emailVerified" BOOLEAN NOT NULL DEFAULT false` | **type change**: timestamp vs boolean |
| | name, image | text | TEXT | same |
| | password, googleId, githubId, sessionVersion, failedLoginAttempts, lockedUntil, createdAt, updatedAt | absent | present | Prisma only |
| **Auth.js** | `accounts` (provider, providerAccountId PK, OAuth token columns), `sessions`, `verification_tokens` | present | absent | Drizzle only. `accounts` duplicates Google tokens a second time |
| **OTP** | | absent | `VerificationToken` (email, type enum, otpHash, payload, attempts, expiresAt) | Prisma only. The name collides conceptually with Auth.js `verification_tokens` but has a different shape |
| **Passkeys / challenges / rate limit / auth events** | | absent | `PasskeyCredential`, `WebAuthnChallenge`, `RateLimitAttempt`, `AuthEvent` + enums | Prisma only |
| **IntegrationAccount** | table | `integration_accounts` | `"IntegrationAccount"` | |
| | id | uuid | TEXT cuid | |
| | userId | `user_id text` FK users | `TEXT` FK User | different parent tables |
| | provider | `text` (TS enum `['google']`) | `TEXT` | same storage |
| | accessToken / refreshToken | `text NOT NULL` / `text` | `TEXT NOT NULL` / `TEXT` | **both plaintext** |
| | scopes, expiresAt, createdAt | text / timestamp / timestamp default now() | same, `TIMESTAMP(3)` | |
| | unique | `integration_accounts_user_provider_idx (user_id, provider)` (migration 0001) | `IntegrationAccount_userId_provider_key` | equivalent |
| **Task** | table | `tasks` | `"Task"` | |
| | id | uuid | TEXT cuid | |
| | title | text NOT NULL | TEXT NOT NULL | same |
| | notes | text | TEXT | same (ADR-005 renames this to `description`) |
| | dueDate | `due_date timestamp` | `"dueDate" TIMESTAMP(3)` | same semantics |
| | status | `text DEFAULT 'open'` (TS enum open/completed/deleted, no DB CHECK) | `TEXT DEFAULT 'open'` | same. No DB constraint in either |
| | completedAt, createdAt | same | same | |
| | updatedAt | `DEFAULT now() NOT NULL` | `NOT NULL`, no DB default (`@updatedAt` is set by the client) | raw-SQL inserts into `"Task"` must supply it |
| | indexes | **none** on `user_id` | `Task_userId_idx` | Prisma better |
| **Memory** | table | `memories` | `"Memory"` | |
| | embedding | `vector(512)` (custom type) | `Unsupported("vector(512)")` | same |
| | indexes | none on user_id; HNSW `memories_embedding_idx` (0002) | `Memory_userId_idx`; HNSW **`memories_embedding_idx`** on `"Memory"` (second migration, `IF NOT EXISTS`) | **Name collision**, see below |
| **DailyBriefing** | briefingDate | `briefing_date date` | `"briefingDate" TEXT` | **type regression** (date to text) |
| | attentionItems / digestItems | jsonb NOT NULL | JSONB NOT NULL | same (string arrays in practice) |
| | indexes | none | `(userId, generatedAt)` | |
| | uniqueness per day | none | none | both allow duplicates |
| **AgentRun** | all fields | id, user_id, input, tool_calls, latency_ms, token_cost, created_at | same in camelCase | no userId index in either |
| **AgentAction** | status | `text` (TS enum success/error) | `TEXT` | same |
| | idempotencyKey | unique | unique | same |

**Index-name collision (high-impact finding).** Postgres index names share
the relation namespace of a schema [V: Postgres semantics]. On a database where Drizzle
migration `0002` already ran, Prisma's `CREATE INDEX IF NOT EXISTS memories_embedding_idx ON "Memory" …`
finds a relation called `memories_embedding_idx` (on `memories`) and **silently skips**. As a result
`"Memory"` has **no vector index** on such a database. The deployment checklist says the
Neon dev branch had all three Drizzle migrations applied [V: `deployment-checklist.md` §2], so this
is the expected state of that branch if Prisma migrations were also deployed there [A].
The fix migration is in `docs/03-data-model.md` §7.2 (M1).

**Migration bookkeeping** [V]: Drizzle records applied migrations in `drizzle.__drizzle_migrations`
(drizzle-kit default) [A: default location, not inspected remotely]. Prisma uses `public._prisma_migrations`.
The local `aios_test` database is empty (no relations, no `_prisma_migrations`). pgvector 0.6.0 is installed there [V].

### 5.2 Old vs new auth coexistence

| Concern | Legacy (Auth.js + Drizzle) | New (hand-rolled JWT + Prisma) | Effect today |
|---|---|---|---|
| Session artifact | DB session row in `sessions` and the Auth.js cookie (`authjs.session-token`) [A: default cookie name] | `session` JWT cookie (HS256, 30 d) | Two independent cookies |
| Session check | `auth()` in `app/(app)/layout.tsx`, pages, `/api/command` | `middleware.ts` (signature only), `getSession()` (passkey registration only) | A request to `/today` needs **both**: middleware requires the JWT, then the layout requires the Auth.js session |
| Sign-in entry | `/api/auth/signin` (hero CTAs, layout redirect) | `/sign-in` (middleware redirect) | Users get bounced between the two sign-in UIs |
| Sign-out | Auth.js `signOut()` server action in the layout | none | The JWT can't be cleared from the UI |
| User table | `users` (text id) | `"User"` (cuid) | The same email produces two unrelated user ids |
| Google tokens written to | `accounts` (adapter) **and** `integration_accounts` (`persist-integration-account.ts`) | `"IntegrationAccount"` (`google/callback`) | Three copies, all plaintext |
| Google tokens read from | n/a | `getFreshAccessToken` reads `"IntegrationAccount"` by **the caller's user id** | `/api/command` passes an **Auth.js user id**, so the lookup misses and returns `NoIntegrationAccountError`, which the user sees as "reconnect Google" on every command [V: code path] |
| Tasks, memory, agent logs | Drizzle tables keyed by Auth.js user id | Prisma tables exist but nothing writes them | All app data lives in legacy tables |
| Briefing job | `loadAccountUserIds` reads Drizzle `integration_accounts` | token read from Prisma | Each user's token lookup misses, the error is logged and swallowed, so **no briefing is ever generated** [V: code path] |
| Google redirect URIs | `/api/auth/callback/google` | `/api/auth/google/callback` | Both must be registered on the OAuth client |
| Env vars | `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET` | `JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_*`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL` | Both sets required to build [V: `.env.example`] |

Conclusion [V]: no end-to-end path works today. Auth works in isolation, and the
legacy app works only for a user who holds both cookies and whose Prisma user id
happens to equal the Auth.js id, which never happens. ADR-002's cutover is a
prerequisite for every other V1 feature.

---

## 6. Behavioural gaps against the ADRs

| Area | Current | ADR target |
|---|---|---|
| Command safety | The model calls `create/update/complete/delete_task` and `create_email_draft` directly. Dates are model-produced ISO strings (`z.string().datetime()`) [V] | Propose, validate, confirm, execute (ADR-007). Server-side date resolution (ADR-008) |
| Idempotency | Key is `${agentRunId}:${toolCallId}`. A new HTTP request creates a new `agent_runs` row, so a retry re-applies the mutation [V] | `clientRequestId` unique per user. The proposal id is the execution key |
| Briefing | One cron at 08:00 UTC for all users, sequential loop, no status, duplicates allowed, string arrays, no grounding [V] | 15-min scheduler, per-user event, `BriefingRun` state machine, typed grounded items (ADR-010) |
| Ownership | Pre-read then scoped update (`lib/tasks/queries.ts`) [V] | Scoped `updateMany` with version (ADR-006) |
| Token storage | Plaintext in three tables [V] | AES-256-GCM `v1:` (ADR-011) |
| Auth abuse controls | Per-account lockout only [V] | Postgres fixed-window limiter by IP and email hash, plus AuthEvent (ADR-012) |
| Rate limit in dev/test | `Redis.fromEnv()` with no fallback [V] | Fail-closed in-memory fallback (ADR-012) |
| DB driver | Neon adapter only, so 3 DB test files can't run locally [V] | URL-selected adapter (ADR-003) |

---

## 7. Unsafe items

Severity uses impact for a multi-user deployment.

| # | Sev | Item | Evidence |
|---|---|---|---|
| U1 | High | **Passkey auth options leak every credential.** `prisma.passkeyCredential.findMany({ select: { id, transports } })` with no user filter is returned to unauthenticated callers as `allowCredentials`. It is unbounded and leaks credential ids across users | `app/api/auth/passkey/auth/options/route.ts` [V] |
| U2 | High | **Passkey challenge not bound to the client.** Verify picks the globally newest unexpired challenge (`findFirst` with no binding). Concurrent sign-ins fail spuriously, and any caller can mint challenge rows without limit (DoS / table growth). Locked or unverified users are not rejected. The handler returns a 307 to a `fetch` POST | `passkey/auth/verify/route.ts` [V] |
| U3 | High | Mutations re-apply on HTTP retry (idempotency key is per run) | `lib/ai/tools/index.ts` [V] |
| U4 | High | The model authorises its own mutations, including Gmail draft creation from untrusted email content (prompt injection path) | `lib/ai/tools/index.ts`, `lib/ai/orchestrator.ts` [V] |
| U5 | High | OAuth access and refresh tokens are stored in plaintext in `"IntegrationAccount"`, `integration_accounts` and `accounts` | schemas [V] |
| U6 | Med | `/api/command` and every future `/api/*` route are outside the middleware matcher. They rely only on handler checks, and `/api/command` uses the legacy `auth()` | `middleware.ts` [V] |
| U7 | Med | Open redirect: `/sign-in?callbackUrl=https://evil.example` is passed to `router.push` without a same-origin check | `app/sign-in/page.tsx` [V]. That `router.push` navigates off-site for absolute URLs [A] |
| U8 | Med | No IP or email rate limit on login, signup, OTP or forgot-password. Signup returns 409 for existing emails, and the login timing differs for unknown emails (no bcrypt on miss), so both allow account enumeration | auth routes [V] |
| U9 | Med | No `AuthEvent` is written for any outcome. There is no audit trail | grep [V] |
| U10 | Med | Google sign-in links to an existing **unverified** password account by email and leaves that account's password intact (pre-account-takeover pattern). Impact is limited because an unverified account can't log in, but the link should verify the email and clear the unverified password | `google/callback/route.ts` [V] |
| U11 | Med | The Google `id_token` is decoded without checking signature, `aud`, `iss` or `exp` | `lib/auth/google-oauth.ts` [V] |
| U12 | Med | The HNSW index is missing on `"Memory"` in a database that previously ran Drizzle 0002 (§5.1) | migrations [V], remote state [A] |
| U13 | Low | `TokenRefreshFailedError.cause` includes Google's error response body, which gets logged by `/api/command`. It contains no tokens on error responses [A], but a redaction policy should still apply | `refresh-token.ts` [V] |
| U14 | Low | Module-scope env access (`new Resend()`, `Redis.fromEnv()`, `neon(DATABASE_URL!)`, the `NEXT_PUBLIC_APP_URL`/`JWT_SECRET` throws) breaks builds and tests without env | files [V], checklist §0 [V] |
| U15 | Low | `PasskeyCredential.counter` is `Int` (int32). The WebAuthn counter is uint32 | schema [V] |
| U16 | Low | No CSRF Origin check on JSON POST routes. SameSite=Lax mitigates this. `/api/command` accepts a body without `Content-Type` | routes [V] |
| U17 | Low | Reminders don't exist. "Remind me about X" can only become a memory or a task, and nothing ever fires (the V1 success criterion can't be met) | tool registry [V] |

---

## 8. Test coverage per module

Test counts come from `vitest run --reporter=json` with no env vars: 37 files, 141
tests, 140 passing. Six files fail at import because env vars are missing (0 tests
collected in five of them; `lib/prisma.test.ts` collects 2, 1 passes and 1 fails on connect) [V].

| Module | Test file | Tests | Status w/o env |
|---|---|---|---|
| auth routes | `app/api/auth/signup/route.test.ts` | 4 | pass |
| | `verify-otp/route.test.ts` | 6 | pass |
| | `login/route.test.ts` | 9 | pass |
| | `forgot-password/route.test.ts` | 5 | pass |
| | `reset-password/route.test.ts` | 6 | pass |
| | `google/route.test.ts` / `google/callback/route.test.ts` | 3 / 11 | pass |
| | `github/route.test.ts` / `github/callback/route.test.ts` | 3 / 10 | pass |
| | `passkey/register/options/route.test.ts` | 7 (static count) | **fail: `NEXT_PUBLIC_APP_URL`** |
| | `passkey/register/verify/route.test.ts` | 12 (static count) | **fail: same** |
| | `passkey/auth/*` | **0** | no tests |
| | `[...nextauth]` | 0 | n/a |
| lib/auth | `jwt` 3, `session` 3, `cookies` 3, `password` 2, `otp` 1, `google-oauth` 2, `github-oauth` 16, `persist-integration-account` 2 | 32 | pass |
| | `webauthn.test.ts` | 5 (static) | **fail: `NEXT_PUBLIC_APP_URL`** |
| command | `app/api/command/route.test.ts` | 6 | pass (mocks `auth()`) |
| ai | `orchestrator` 2, `tools/index` 2, `idempotency` 7, `embeddings` 2 | 13 | pass (Drizzle mocked) |
| tasks | `lib/tasks/queries.test.ts` | 6 (static) | **fail: needs a real DB (`neon()`)** |
| memory | `lib/memory/queries.test.ts` | 5 (static) | **fail: same** |
| prisma | `lib/prisma.test.ts` | 2 | 1 pass, 1 fail (connect) |
| integrations | `google/refresh-token` 9, `gmail/client` 3, `calendar/client` 3, `web/client` 5 | 20 | pass |
| rate limit | `lib/rate-limit.test.ts` | 1 | pass (mocked) |
| briefing | `inngest/daily-briefing.test.ts` | 5 | pass |
| db | `db/schema/schema.test.ts` | 1 | pass (export smoke test) |
| components | `briefing-view` 2, `task-list` 2 | 4 | pass |
| middleware | none | 0 | **untested** |
| pages (`app/**/page.tsx`) | none | 0 | untested |

Coverage gaps [V]:
- There are no cross-user isolation tests at the data layer, because the DB tests can't run.
- Middleware has no tests.
- Passkey auth has no tests.
- There are no end-to-end or browser tests.
- No line-coverage tool is configured (`vitest --coverage` is not set up).

---

## 9. Existing documentation and consolidation

| Doc | Kind | Still accurate? | Superseded by |
|---|---|---|---|
| `docs/superpowers/specs/2026-08-24-personal-os-v1-design.md` | product and technical spec (V1, Drizzle/Auth.js) | Product intent: yes. Stack (§5, §9, §10): no | `00-product-spec.md`, `02-system-architecture.md`, `03-data-model.md` |
| `docs/superpowers/specs/2026-08-25-auth-prisma-migration-design.md` | auth/ORM migration spec | Architecture: yes. "Clean-slate, no data migration" (§2, §6): **overridden by ADR-004** | `02` §4, `03` §7 |
| `docs/superpowers/plans/2026-08-24-personal-os-v1.md` | task plan, executed | Historical | `08-implementation-plan.md` |
| `docs/superpowers/plans/2026-08-25-auth-prisma-foundation.md` | task plan, executed through task 9 | Tasks 10–13 partly open | `08-implementation-plan.md` |
| `docs/superpowers/plans/deployment-checklist.md` | ops checklist | **Stale**: Drizzle `db:migrate`, Auth.js env vars, 08:00 UTC cron, "dev branch is fully migrated, point prod at it" | `02` §9 (topology), `03` §7 (cutover runbook) |

Consolidation [V: plan, not executed here]:
- Keep all five files unchanged as historical records. Do not delete or rewrite them.
- The numbered docs (`docs/00-…`, `01-…`) are the source of truth. Each numbered doc
  cites the historical doc it supersedes, as in the table above.
- When a doc owner next touches them, add a one-line "Historical — superseded by …" banner
  at the top of each `docs/superpowers` file. That is the only edit allowed.
- `deployment-checklist.md` §2 tells an operator to reuse the Drizzle-migrated dev branch
  for production. Operators must instead follow `docs/03-data-model.md` §7. This is the
  most dangerous stale instruction.

---

## 10. What to retain

- **The whole hand-rolled auth surface** (`lib/auth/*`, `app/api/auth/*` except
  `[...nextauth]`). Its hardening is careful: verified-email checks, googleId-first lookup,
  refresh-token preservation, atomic OTP attempt reservation, lockout-expiry semantics,
  timing parity on forgot-password, stable WebAuthn user handle. Keep it, and fix U1, U2, U7, U8, U10 and U11.
- `getFreshAccessToken` semantics: 5-minute margin, typed errors, no token values in messages.
- The capability interfaces (`lib/integrations/types.ts`) and the three adapters.
- The idempotency wrapper's race-handling ideas. They are reused for proposal execution
  under a different key, implemented as a state transition rather than delete-then-insert.
- Keeping OAuth tokens out of Inngest step state (`loadAccountUserIds` returns ids only).
- `generateObject` with a Zod schema for the briefing.
- The `@vitest-environment node` pattern for Prisma/Neon tests.
- The landing hero, footer, auth pages and shadcn primitives (visual layer, ADR-013/014).

---

## 11. Recommended changes (ordered)

1. **ADR-003**: make `lib/prisma.ts` choose its adapter from the URL. Run DB tests on local
   `aios_test`. Make env reads lazy (U14).
2. **ADR-002 cutover**: port tasks, memory, briefing, pages, command route and component
   types to Prisma repositories (ADR-006) and `getSession()`. Expand the middleware matcher to
   the whole `(app)` group and `/api/*` except public auth and Inngest routes. Add `POST /api/auth/logout`.
   Repoint the hero CTAs to `/sign-in`. Delete the legacy files and dependencies.
3. **Fix the Memory HNSW index name collision** with an additive migration (`03` §7.2 M1).
4. **Fix passkey auth** (U1, U2): no `allowCredentials` (discoverable credentials), a challenge
   bound to an httpOnly nonce cookie, purpose-scoped challenge rows, lock/verification checks,
   JSON response instead of a 307, and tests.
5. **ADR-012**: Postgres auth rate limiting, an `AuthEvent` for every outcome, same-origin `callbackUrl`.
6. **ADR-011**: token encryption and a one-off encryption script for existing rows.
7. **ADR-005/007/008**: task model v2, the command pipeline with `clientRequestId`,
   ProposedAction and policy, and chrono-based dates.
8. **ADR-010**: BriefingRun, the 15-minute scheduler, grounding, and enqueue on page load.
9. Observability: a structured logger with request ids and redaction (`02` §8).
10. Remove `framer-motion` and the orphan components. Update `.env.example`, `db:migrate` and the
    deployment docs.
