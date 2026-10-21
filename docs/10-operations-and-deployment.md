# 10 — Operations and Deployment

Scope: configuration, secrets, background jobs, observability, backups, deployment,
migrations, rollback, incident response, recovery and key rotation for Personal OS V1
(single Next.js app on Vercel, Neon Postgres, Inngest, Upstash, Resend, Anthropic, Voyage,
Tavily, Google APIs).

Supersedes the Drizzle/Auth.js-era steps in `docs/superpowers/plans/deployment-checklist.md`
(that file remains as history). Local procedures are in `docs/13-runbook.md`.

---

## 1. Environment variables (target state)

Legend — **Req**: `all` = required in every environment; `prod` = required in Preview and
Production; `opt` = optional with default. **Build**: must be present at `next build` time
(module-scope reads). Secret values are never committed; `.env.example` holds names only.

| Name | Req | Build | Secret | Where used | Example / format |
|---|---|---|---|---|---|
| `DATABASE_URL` | all | yes | yes | `lib/prisma.ts` (adapter chosen by host, ADR-003), `prisma.config.ts` | `postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/aios?sslmode=require` (pooled) / `postgresql://aios:aios@localhost:5432/aios_dev` |
| `JWT_SECRET` | all | yes | yes | `lib/auth/jwt.ts` — throws at import if < 32 chars; used by `middleware.ts` (edge) and `lib/auth/session.ts` | `openssl rand -base64 33` |
| `NEXT_PUBLIC_APP_URL` | all | yes | no | `lib/auth/webauthn.ts` (RP ID/origin — throws at import if unset), OAuth `redirect_uri` in `lib/auth/google-oauth.ts`, `lib/auth/github-oauth.ts` | `https://personal-os.example.com` (no trailing slash) |
| `TOKEN_ENCRYPTION_KEY` | all | no | yes | `lib/crypto/tokens.ts` (new, ADR-011): AES-256-GCM for `IntegrationAccount.accessToken/refreshToken` | base64 of 32 random bytes: `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY_ID` | opt | no | no | same; prefix written on new ciphertext | `v1` (default) |
| `TOKEN_ENCRYPTION_KEY_PREVIOUS` | opt | no | yes | same; decrypt-only during rotation | `v1:<base64 32 bytes>` |
| `GOOGLE_CLIENT_ID` | prod | no | no* | `lib/auth/google-oauth.ts`, `lib/integrations/google/refresh-token.ts` | `1234-abc.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | prod | no | yes | same | from Google Cloud console |
| `GITHUB_CLIENT_ID` | prod | no | no* | `lib/auth/github-oauth.ts` | `Iv1.abc123` |
| `GITHUB_CLIENT_SECRET` | prod | no | yes | same | from GitHub OAuth app |
| `RESEND_API_KEY` | prod | no | yes | `lib/auth/otp.ts` (`new Resend(...)` at module scope) | `re_…` |
| `EMAIL_FROM` | opt | no | no | `lib/auth/otp.ts` (currently hard-coded `Personal OS <noreply@personal-os.app>`) | `Personal OS <noreply@yourdomain>` — domain must be verified in Resend |
| `ANTHROPIC_API_KEY` | prod | no | yes | `@ai-sdk/anthropic` via `lib/ai/provider.ts` | `sk-ant-…` |
| `AI_MODEL` | opt | no | no | `lib/ai/provider.ts` (ADR-009); `mock` allowed only when `E2E=1` or tests | `claude-sonnet-5` (default) |
| `VOYAGE_API_KEY` | prod | no | yes | `lib/ai/embeddings.ts` | `pa-…` |
| `TAVILY_API_KEY` | opt | no | yes | `lib/integrations/web/client.ts` (currently read in `app/api/command/route.ts`); if unset, `search_web` is not registered | `tvly-…` |
| `UPSTASH_REDIS_REST_URL` | prod | **yes** | no* | `lib/rate-limit.ts` `Redis.fromEnv()` at module scope; absent → in-memory fail-closed fallback (ADR-012) in dev/test only | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | prod | **yes** | yes | same | from Upstash console |
| `INNGEST_EVENT_KEY` | prod | no | yes | `inngest/client.ts` (SDK reads env) — sending events | from Inngest dashboard |
| `INNGEST_SIGNING_KEY` | prod | no | yes | `app/api/inngest/route.ts` `serve()` — verifies Inngest requests | `signkey-prod-…` |
| `INNGEST_DEV` | opt | no | no | Inngest SDK; set `1` locally to target the dev server | `1` (local only) |
| `BRIEFING_DEFAULT_HOUR` | opt | no | no | `inngest/briefing-scheduler.ts` (new): default for users without `UserPreference.briefingTime` | `06:30` (local `HH:mm`; ADR-010 default) |
| `LOG_LEVEL` | opt | no | no | `lib/log.ts` (new) | `info` (prod), `debug` (dev), `warn` (test) |

\* Client ids / Upstash URL are not secret in the cryptographic sense but are kept in the
secrets store anyway so they rotate together with their secrets.

**Removed in the target state** (ADR-002): `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
(Auth.js). Delete them from Vercel after the cutover deploy is verified, not before.

**Test-only** (never set in Vercel Production; startup asserts this): `E2E`, `E2E_FIXED_NOW`,
`GOOGLE_API_BASE_URL`, `EMAIL_TRANSPORT=log` (`docs/09-test-strategy.md` §10).

### 1.1 Startup validation

`lib/env.ts` (new) parses `process.env` with Zod once per process and is imported by
`instrumentation.ts`. Rules: required-per-`VERCEL_ENV` sets as above; `JWT_SECRET.length ≥ 32`;
`TOKEN_ENCRYPTION_KEY` decodes to exactly 32 bytes; `NEXT_PUBLIC_APP_URL` is an absolute URL
without trailing slash and `https:` outside development; test-only vars absent in production.
Failure logs the **names** of missing/invalid vars (never values) and exits. Module-scope reads
that currently crash builds (`lib/auth/jwt.ts`, `lib/auth/webauthn.ts`, `db/client.ts`) move behind
lazy getters so `next build` only needs the variables marked **Build**.

---

## 2. Secrets management

- **Store:** Vercel Project → Settings → Environment Variables, scoped separately to
  Production, Preview and Development. Mark every "Secret = yes" row as *Sensitive* (write-only
  in the UI).
- **Separation:** Production and Preview use different values for `JWT_SECRET`,
  `TOKEN_ENCRYPTION_KEY`, `DATABASE_URL` (Preview points at a Neon branch), Inngest keys (Inngest
  branch environments) and OAuth apps (separate Google/GitHub OAuth clients for preview domains).
  A Preview deploy must never be able to read production tokens.
- **Local:** `.env.local` (git-ignored by `.gitignore`'s `.env*` rule with `!.env.example`). Use
  `vercel env pull .env.local` only for the Development scope.
- **Never** log, return in errors, persist in Inngest step outputs, or put in `AgentAction.output`:
  OAuth tokens, `JWT_SECRET`, OTP codes, password hashes. The existing pattern in
  `lib/integrations/google/refresh-token.ts` (describe the *shape* of a failed token response,
  never its values) is the norm. `inngest/daily-briefing.ts` already returns bare user ids from
  steps for this reason.
- **Access:** one owner account on Vercel, Neon, Upstash, Inngest, Resend, Anthropic, Google Cloud,
  GitHub. 2FA on each. Keep an offline inventory (provider → secret name → last rotated date).

---

## 3. Inngest operations

### 3.1 Functions (target)

| Function id | Trigger | Concurrency / idempotency | Retries | Purpose |
|---|---|---|---|---|
| `briefing-scheduler` | cron `*/15 * * * *` (UTC) | single instance | 0 (next tick covers) | For each user whose local time ≥ `briefingTime` (or `BRIEFING_DEFAULT_HOUR`) and who has no `BriefingRun` for the local date, emit `briefing/generate.requested { userId, localDate }` (ADR-010) |
| `briefing-generate` | event `briefing/generate.requested` | `concurrency: { key: 'event.data.userId', limit: 1 }`, `idempotency: 'event.data.userId + "-" + event.data.localDate'` | 3, backoff | Upsert `BriefingRun` (`@@unique([userId, localDate])`) → `RUNNING`; fetch sources in separate steps; generate; ground; persist `SUCCEEDED`/`PARTIAL`/`FAILED` |
| `reminder-fire` | event `reminder/due` with `ts` = remindAt | idempotency on `reminderId` | 3 | Deliver reminder (in-app notification in V1) and mark `firedAt` |
| `maintenance-cleanup` | cron `17 3 * * *` | single | 1 | Delete expired `WebAuthnChallenge`, `VerificationToken`, old `RateLimitAttempt` windows; expire `ProposedAction` past `expiresAt`; mark stale `AgentRun RUNNING` > 60 s `FAILED` |

Current state (verified): one function `daily-briefing`, cron `0 8 * * *` UTC, loops users
sequentially inside one run with per-user try/catch, Drizzle writes, no `BriefingRun`.

### 3.2 Operating procedures

- **Register / resync:** Inngest dashboard → Apps → sync URL `https://<domain>/api/inngest`
  (exact path; see `app/api/inngest/route.ts`). Vercel integration auto-syncs on deploy; verify
  each function id above appears after every deploy that changes `serve({ functions })`.
- **Replay a user's briefing:** send `briefing/generate.requested { userId, localDate }` from the
  dashboard. Because of the idempotency key, a replay of a date that already `SUCCEEDED` is a
  no-op; to force regeneration, first set that `BriefingRun.status = 'FAILED'` via an admin SQL
  statement on a branch-tested query, then send the event with a new idempotency suffix
  (`localDate` + `#retry1`). Record the action in the incident log.
- **Pause:** Inngest dashboard → function → Pause (e.g. during a provider outage or migration).
  The scheduler's "no run for local date" rule backfills automatically on resume the same day.
- **Failures:** alert on `briefing-generate` failure rate > 10% over 1 h or any `FAILED` for > 20%
  of users on a date. Step output must contain ids and counts only.
- **Signing:** `INNGEST_SIGNING_KEY` mismatch shows as 401s on `/api/inngest` in Vercel logs and
  "unreachable" in Inngest; fix the key, redeploy, resync.

---

## 4. Monitoring and metrics

Sources: Vercel Observability (function duration, errors, cold starts), Vercel Log Drains →
log backend (assumption: Axiom/Better Stack free tier — any JSON-capable drain works), Inngest
dashboard, Neon monitoring, Upstash and Anthropic console usage.

| Metric | Derived from | Alert threshold |
|---|---|---|
| Command latency p50/p95 | `command.completed` log `latency_ms` | p95 > 10 s for 15 min |
| Command error rate by `code` | `command.completed` | `MODEL_ERROR`+`INTERNAL` > 2% for 10 min |
| Clarification / confirmation / cancel rates | `command.completed.kind`, `proposal.*` | weekly review |
| Tokens per day (total, per user) | `AgentRun.inputTokens/outputTokens` | daily total > 2× 7-day avg; per-user > 200k |
| Briefing success / partial / failed per local date | `BriefingRun.status` | FAILED > 20% of users |
| Briefing lateness | `BriefingRun.completedAt − scheduled local time` | p95 > 30 min |
| Google token refresh failures | `integration.token_refresh_failed` | > 5/h (could be a client-secret problem, not users) |
| Auth failures / lockouts | `AuthEvent` (`LOGIN_FAILURE`, `ACCOUNT_LOCKED`) | 5× baseline in 1 h |
| Rate-limit rejections | `ratelimit.rejected{bucket}` | — |
| 5xx rate per route | Vercel | > 1% for 10 min |
| DB connections / slow queries | Neon | slow query > 500 ms recurring |
| Upstash fallback active in prod | `ratelimit.fallback` | any (should never happen in prod) |

A `/api/health` route (new) returns `{ ok, db: 'ok'|'fail', version }` with a `SELECT 1` and no
secrets; used by an external uptime check every 5 min.

---

## 5. Structured logging and redaction

- `lib/log.ts` (new): JSON lines to stdout, fields `ts, level, event, requestId, userId (cuid),
  route, durationMs, code, …`. Level from `LOG_LEVEL`. Replace ad-hoc `console.error` calls (e.g.
  `app/api/command/route.ts`, `inngest/daily-briefing.ts`, `lib/ai/idempotency.ts`).
- `requestId`: from `x-vercel-id` or generated; returned as `x-request-id` header and included in
  error responses so a user report can be traced.
- **Redaction** (applied by the logger, not by callers): keys matching
  `/token|secret|password|otp|authorization|cookie|refresh|access/i` → `"[redacted]"`; email
  addresses → `a***@domain`; free-text user input, email bodies, memory content and task
  descriptions are never logged — only lengths and hashes (`sha256` first 12 hex). `AgentRun.input`
  is stored in the DB (user-owned data) but not in logs.
- Error objects: log `name`, `message`, `code`, and `cause` only after passing through the same
  redactor (Google's error bodies are safe to log as shown in `refresh-token.ts`; token responses are not).
- Retention: log drain 30 days; DB audit (`AgentRun`, `AgentAction`, `AuthEvent`, `TaskEvent`)
  retained with the user's data and deleted with the account (cascade).

---

## 6. Backups (Neon)

- **Point-in-time restore (PITR):** Neon's history retention window (plan dependent; free tier is
  short — assumption: verify the current plan's window and record it here). Restore is done by
  creating a branch at a timestamp, never by overwriting the primary in place.
- **Pre-change branches:** before every production migration or data fix, create a branch
  `pre-<yyyymmdd>-<change>` from production (ADR-004). Keep for 14 days.
- **Logical dump:** weekly `pg_dump --format=custom` of production from a read-only role to
  owner-controlled storage, encrypted at rest; OAuth tokens are already ciphertext (ADR-011) so the
  dump does not expose them without `TOKEN_ENCRYPTION_KEY`, which is stored separately.
- **Restore drill:** quarterly — restore the latest dump into a scratch Neon branch, run
  `prisma migrate status`, run the smoke test suite against it with a Preview deployment.

---

## 7. Deployment (Vercel)

### 7.1 Pipeline

```mermaid
flowchart LR
  PR[PR to main] --> CI[CI: tsc, lint, unit, integration, build, e2e]
  CI --> PV[Vercel Preview<br/>Neon preview branch + Inngest branch env]
  PV --> SM[Smoke tests on preview URL]
  SM --> MG[Merge]
  MG --> MIG[Operator: prisma migrate deploy on prod<br/>after pre-change branch]
  MIG --> PROD[Vercel Production build + promote]
  PROD --> SYNC[Inngest sync + post-deploy smoke]
```

### 7.2 Production deploy checklist

1. CI green on the merge commit.
2. If `prisma/migrations` changed: run §7.3 **before** promoting the deploy. Migrations must be
   backward compatible with the currently-running code (expand → deploy → contract).
3. Build env present (§1 **Build** column): `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_APP_URL`,
   `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
4. Deploy (Vercel Git integration or `vercel --prod`).
5. Verify Inngest functions synced (§3.2).
6. Smoke test: `/api/health` ok; sign in (password + Google); `/today` renders a briefing or
   "preparing" state; command "create a task called deploy smoke test due tomorrow" → `executed`
   and visible in `/tasks`; undo it.
7. Watch error rate and latency for 30 minutes.

### 7.3 Migration procedure

1. Create Neon branch `pre-<date>-<migration>` from production.
2. Point a shell (not Vercel) at the branch's **direct** (non-pooler) URL and run
   `pnpm exec prisma migrate deploy`; then `pnpm exec prisma migrate status`. (Assumption: Neon's
   pooled endpoint is not used for DDL; `prisma.config.ts` reads `DATABASE_URL`, so the operator
   overrides it for this command.)
3. Run the data checks for that migration (e.g. for the Drizzle → Prisma cutover, ADR-004: count
   rows in old Drizzle tables `tasks`, `memories`, `integration_accounts`, `daily_briefings`,
   `agent_runs`, `agent_actions`; if any are non-zero, run the copy script on the branch and diff counts).
4. Run the Preview deployment against the branch and smoke-test.
5. Repeat step 2 against production's direct URL.
6. Never run `prisma migrate dev`, `prisma db push` or `migrate reset` against Neon.

### 7.4 Rollback

| Situation | Action |
|---|---|
| Bad code, no migration | Vercel → Deployments → previous production deployment → *Instant Rollback*. Resync Inngest if function set changed. |
| Bad code + backward-compatible migration | Instant Rollback of code only; leave schema (expand-only migrations are safe for old code). |
| Destructive/incompatible migration shipped | Stop writes (Vercel: set `MAINTENANCE=1` → middleware returns 503 for app routes; pause Inngest functions), restore by promoting the `pre-…` branch or a PITR branch to primary in Neon, update `DATABASE_URL` if the endpoint changed, redeploy the previous build, resume Inngest. Data written after the branch point is lost — reconcile from `TaskEvent` if needed. |
| Bad AI behaviour (prompt/model) | Set `AI_MODEL` to the last known good id or roll back the deployment; mutating behaviour is bounded by policy regardless. |

---

## 8. Incident response

Severity: **SEV1** data exposure across users, tokens leaked, or app down; **SEV2** a core flow
broken (commands, briefing, sign-in) for most users; **SEV3** degraded/partial.

1. **Detect** — alert or user report (ask for `x-request-id`).
2. **Contain** — SEV1: rotate exposed secrets (§9) immediately, bump every user's
   `sessionVersion` (`UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1`) to invalidate all
   sessions, pause Inngest, enable `MAINTENANCE=1` if data integrity is at risk. Provider outage:
   nothing to contain — commands degrade per tool (`PROVIDER_UNAVAILABLE`), briefings go `PARTIAL`.
3. **Diagnose** — logs by `requestId`/`userId`; `AgentRun`/`AgentAction`/`ProposedAction`/`TaskEvent`
   give a full trace of what the command pipeline did.
4. **Recover** — rollback (§7.4) or fix-forward; replay failed briefings (§3.2).
5. **Communicate** — for any cross-user exposure, notify affected users with what was exposed.
6. **Review** — written post-incident note within 5 days: timeline, root cause, regression test
   added (the test must exist before the incident is closed).

---

## 9. Key rotation

| Secret | Procedure | Impact |
|---|---|---|
| `JWT_SECRET` | Set new value in Vercel → redeploy. | All sessions invalid (users sign in again). For a planned rotation without forced logout, a dual-key verify (`JWT_SECRET_PREVIOUS`) would be needed — not in V1. |
| `TOKEN_ENCRYPTION_KEY` | 1) Set `TOKEN_ENCRYPTION_KEY_PREVIOUS = v1:<old>`; set new `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_ID = v2`; deploy. Reads accept `v1:` and `v2:`, writes use `v2:`. 2) Run `scripts/reencrypt-tokens.ts` (batch re-encrypt, idempotent by prefix). 3) Verify `SELECT count(*) FROM "IntegrationAccount" WHERE "accessToken" LIKE 'v1:%'` = 0. 4) Remove `TOKEN_ENCRYPTION_KEY_PREVIOUS`; deploy. | None if done in order. Losing the key = all users must reconnect Google. |
| Google / GitHub client secret | Create second secret in provider console, update Vercel, redeploy, then delete the old secret. | None. |
| Anthropic / Voyage / Tavily / Resend keys | Create new key, update Vercel, redeploy, revoke old. | None. |
| Upstash token | Rotate in console, update Vercel (**build-time** var), redeploy. | Rate limiting falls back/denies until redeployed. |
| Inngest signing key | Inngest supports a rotation flow with fallback key; update `INNGEST_SIGNING_KEY` (and `INNGEST_SIGNING_KEY_FALLBACK` during the window), redeploy, resync. | None if fallback used. |
| Neon DB password | Reset role password in Neon, update `DATABASE_URL`, redeploy. | Brief connection errors during rollout. |

Cadence: on suspicion immediately; otherwise annually, and whenever someone with access leaves.

---

## 10. Recovery scenarios

| Scenario | Detection | Recovery |
|---|---|---|
| Briefing missed for many users | `BriefingRun` count < active users after `briefingTime` + 1 h | Fix cause; scheduler backfills on next tick for today; for past dates, no backfill (briefings are same-day by design) |
| User's Google grant revoked | `TokenRefreshFailedError` with `invalid_grant` | Briefing `PARTIAL`; Today shows reconnect banner; user re-runs Google sign-in which overwrites encrypted tokens |
| Stuck `ProposedAction EXECUTING` | cleanup job finds rows > 5 min | DB-only tools: tx guarantees no partial write → reset to `PENDING` and let the user confirm again. Email drafts: run Message-ID lookup (`docs/04` §11.3) then set `EXECUTED` or `PENDING` |
| Accidental bulk change | `TaskEvent` with shared `batchId` | Undo by `batchId` (reverts each task to `before` snapshot when `version` still matches) |
| Upstash outage | `ratelimit.error` logs | Fail-closed for AI bucket (commands return `RATE_LIMITED` with a "temporarily unavailable" message) — cost safety beats availability; auth limits are in Postgres (ADR-012) and unaffected |
| Anthropic outage | `MODEL_ERROR` spike | Commands fail fast with retryable error; Today page and manual task editing still work; briefings retried by Inngest, then `FAILED` |

---

## 11. Assumptions and open points

- Monitoring backend and uptime checker are not yet chosen (any Vercel log-drain target works).
- Neon plan and its PITR window are unknown from this repo; record them in §6 once confirmed.
- `MAINTENANCE` flag, `/api/health`, `lib/env.ts`, `lib/log.ts`, `scripts/reencrypt-tokens.ts` are
  new code required by this document.
- There is no CI configuration in the repository today; §7.1 is the target.
