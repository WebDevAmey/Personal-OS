# 06 — Security Controls Matrix

Status: baseline (2026-10-21). Threats are defined in `docs/05-security-threat-model.md`;
baseline findings (`SEC-B-nnn`) are in `docs/14-final-security-report.md`.

**Verification status**
- **Not started** — control absent in code.
- **Implemented** — control present in code but no automated test proves it (or the proving
  test is not yet in the suite).
- **Verified** — control present and covered by a passing automated test in `pnpm test`.

Status values below were set by reading the code and its existing tests on 2026-10-21. A
"Verified" status refers to an existing test file that was read during the review; the baseline
`pnpm test` run (lead, 2026-10-21) had 140/141 tests passing, with failures limited to files that
need `DATABASE_URL` / `NEXT_PUBLIC_APP_URL`.

**ASVS references.** `4.0.3 Vx.y.z` = OWASP ASVS 4.0.3 requirement. `5.0 Vn` = ASVS 5.0 chapter
(V6 Authentication, V7 Session Management, V8 Authorization, V9 Self-contained Tokens,
V10 OAuth and OIDC, V3 Web Frontend Security, V1 Encoding and Sanitization, V16 Security
Logging, V15 Secure Coding and Architecture). Chapter-level 5.0 references are used where the
4.0.3 → 5.0 mapping of the individual requirement was not confirmed.

---

## 1. Authentication (T-AUTHN)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS | Status |
|---|---|---|---|---|---|---|
| T-AUTHN-01 | Online password guessing via parallel requests (SEC-B-001) | Atomic failure counter: `updateMany({ where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { failedLoginAttempts: { increment: 1 } } })`, lock when post-increment ≥ 5 | `AuthEvent LOGIN_FAILED`, alert on > 20/min per account | `app/api/auth/login/route.concurrency.test.ts` | 4.0.3 V2.2.1, V11.1.4; 5.0 V6 | Not started |
| T-AUTHN-02 | Credential stuffing across accounts | ADR-012 Postgres fixed-window limiter, keys `login:ip`, `login:email-hash` (e.g. 10/15 min/IP, 5/15 min/email) | `AuthEvent RATE_LIMITED` | `lib/auth/rate-limit.test.ts` | 4.0.3 V2.2.1 | Not started |
| T-AUTHN-03 | Targeted account lockout DoS (SEC-B-007) | Replace hard lock with progressive delay + IP limit; passkey/OAuth sign-in unaffected by password lock; notify user on lock | `AuthEvent ACCOUNT_LOCKED` count per account | `app/api/auth/login/route.test.ts` (lock does not block passkey verify) | 4.0.3 V2.2.1 | Not started |
| T-AUTHN-04 | Account enumeration (SEC-B-006) | Dummy bcrypt compare for unknown users; identical 401 body/status for unknown, wrong password, locked; signup always returns 200 "check your email" and emails existing owners instead | — | `tests/security/enumeration.test.ts` | 4.0.3 V2.2.1; 5.0 V6 | Not started |
| T-AUTHN-05 | Password storage weakness | bcrypt cost 12 (`lib/auth/password.ts:4`) | — | `lib/auth/password.test.ts` (exists: hash/verify round-trip) | 4.0.3 V2.4.1, V2.4.4 | Implemented (cost not asserted by test) |
| T-AUTHN-06 | Weak / overlong passwords (SEC-B-022) | Min 12, max 128 chars, reject > 72 UTF-8 bytes or pre-hash; breached-password check (k-anonymity HIBP) [optional] | — | `lib/auth/password-policy.test.ts` | 4.0.3 V2.1.1, V2.1.2, V2.1.7 | Not started |
| T-AUTHN-07 | OTP prediction | `crypto.randomInt(100000, 1000000)` (`lib/auth/otp.ts:15`) | — | `lib/auth/otp.test.ts` (exists) | 4.0.3 V2.7.4, V2.7.6; 5.0 V6 | Verified |
| T-AUTHN-08 | OTP stored in clear | bcrypt-hashed OTP (`otp.ts:20`) | — | `lib/auth/otp.test.ts` | 5.0 V6 | Verified |
| T-AUTHN-09 | OTP guessing within one token | Atomic attempt reservation, 5 attempts, 10 min TTL (`verify-otp/route.ts:39-45`, `reset-password/route.ts:39-45`) | — | `app/api/auth/verify-otp/route.test.ts`, `app/api/auth/reset-password/route.test.ts` (exist) | 4.0.3 V2.2.1, V2.7.2, V2.7.3 | Verified (mocked Prisma; no real-DB concurrency test) |
| T-AUTHN-10 | Reset-code brute force across many tokens (SEC-B-002) | Per-email caps: ≤ 5 reset tokens / 24 h, ≤ 10 verification attempts / email / 24 h; invalidate older tokens on issue; atomic issuance throttle (unique partial index or `INSERT … WHERE NOT EXISTS`); IP limit | `AuthEvent PASSWORD_RESET_*`, alert on > 3 issues/day/email | `app/api/auth/forgot-password/route.cap.test.ts` | 4.0.3 V2.5.6, V2.2.1; 5.0 V6 | Not started |
| T-AUTHN-11 | Forgot-password timing enumeration | Work deferred via `after()`, constant response (`forgot-password/route.ts:29-50`) | — | `app/api/auth/forgot-password/route.test.ts` (exists) | 4.0.3 V2.5.6 | Verified |
| T-AUTHN-12 | Reset does not revoke sessions | `sessionVersion: { increment: 1 }` on reset (`reset-password/route.ts:55`) | — | `app/api/auth/reset-password/route.test.ts` (exists) | 4.0.3 V3.3.3 | Verified |
| T-AUTHN-13 | Pre-account takeover / squatting (SEC-B-005) | Signup on an existing unverified email replaces that row's password only after OTP proof; OAuth link to an unverified password row clears `password`, sets `emailVerified=true`, bumps `sessionVersion`; unverified rows expire after 24 h | `AuthEvent ACCOUNT_LINKED` | `tests/security/pre-hijack.test.ts` | 5.0 V6, V10 | Not started |
| T-AUTHN-14 | Passkey challenge confusion / replay (SEC-B-003) | Challenge row id in HttpOnly `__Host-pk_chal` cookie (5 min); atomic consume before verify; `userHandle` must match credential owner; `response.id === credentialId` | `AuthEvent PASSKEY_FAILED` | `app/api/auth/passkey/auth/verify/route.test.ts` | 4.0.3 V2.9 (chapter); 5.0 V6 | Not started |
| T-AUTHN-15 | Passkey origin / RP spoofing | `expectedOrigin: ORIGIN`, `expectedRPID: RP_ID` from `NEXT_PUBLIC_APP_URL` (`lib/auth/webauthn.ts:10-11`) | — | `app/api/auth/passkey/register/verify/route.test.ts` (exists) | 5.0 V6 | Verified (registration); Implemented (authentication, no test file) |
| T-AUTHN-16 | Passkey without user verification | `userVerification: 'required'` + library default `requireUserVerification: true` | — | `app/api/auth/passkey/register/options/route.test.ts` (exists) | 5.0 V6 | Verified (registration); Implemented (authentication) |
| T-AUTHN-17 | Cloned authenticator | Counter compared and updated (`passkey/auth/verify/route.ts:63-68`) | Counter regression → `AuthEvent PASSKEY_COUNTER_REGRESSION` | `app/api/auth/passkey/auth/verify/route.test.ts` | 5.0 V6 | Implemented |
| T-AUTHN-18 | Credential ID disclosure / challenge table growth (SEC-B-004) | `allowCredentials: []` for discoverable login; IP limit on options; cron sweep of expired challenges | — | `app/api/auth/passkey/auth/options/route.test.ts` | 5.0 V6 | Not started |
| T-AUTHN-19 | Unverified email sign-in | `emailVerified` gate after password check (`login/route.ts:53-55`) | — | `app/api/auth/login/route.test.ts` (exists) | 4.0.3 V2.5.6 | Verified |

## 2. Session management (T-SESS)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS | Status |
|---|---|---|---|---|---|---|
| T-SESS-01 | JWT algorithm confusion / `alg:none` | `algorithms: ['HS256']` (`jwt.ts:29`) | — | `lib/auth/jwt.test.ts` (exists; extend with `alg:none` and HS512 cases) | 4.0.3 V3.5.3; 5.0 V9 | Implemented |
| T-SESS-02 | Weak signing secret | Boot fails if `JWT_SECRET` < 32 chars (`jwt.ts:8-10`) | — | `lib/auth/jwt.test.ts` | 4.0.3 V6.4.1; 5.0 V9 | Implemented |
| T-SESS-03 | Token not revocable | `sessionVersion` compared in `getSession()` (`session.ts:14-15`) | — | `lib/auth/session.test.ts` (exists) | 4.0.3 V3.3.1, V3.3.3 | Verified |
| T-SESS-04 | Edge gate accepts revoked tokens | Middleware stays a UX redirect only; every handler/page calls `getSession()`; middleware matcher deny-by-default for `/(app)` routes and `/api/**` except auth | — | `tests/security/route-auth-inventory.test.ts` (walks `app/**/route.ts` and pages; asserts each imports `getSession` or is on the public allowlist) | 4.0.3 V4.1.1, V4.1.3 | Not started |
| T-SESS-05 | No logout (SEC-B-009) | `POST /api/auth/logout` clears cookie; "sign out everywhere" bumps `sessionVersion` | `AuthEvent LOGOUT` | `app/api/auth/logout/route.test.ts` | 4.0.3 V3.3.1, V3.3.4 | Not started |
| T-SESS-06 | Long-lived token | 7-day sliding, 30-day absolute; `iss`/`aud` claims | — | `lib/auth/jwt.test.ts` | 4.0.3 V3.3.2; 5.0 V7, V9 | Not started (30-day fixed exp today) |
| T-SESS-07 | Cookie theft over HTTP / script access | `HttpOnly; SameSite=Lax; Path=/; Secure` (prod) | — | `tests/security/cookie-flags.test.ts` | 4.0.3 V3.4.1, V3.4.2, V3.4.3, V3.4.5 | Implemented (no shared helper; flags duplicated in 5 routes) |
| T-SESS-08 | Cookie tossing from sibling subdomain | `__Host-session` name; single `lib/auth/session-cookie.ts` builder | — | `tests/security/cookie-flags.test.ts` | 4.0.3 V3.4.4 | Not started |
| T-SESS-09 | Session not refreshed on privilege change | Bump `sessionVersion` on password change, passkey add/remove, provider link/unlink, email change | — | `lib/auth/session-rotation.test.ts` | 4.0.3 V3.2.1, V3.3.3 | Not started |
| T-SESS-10 | Two identity systems (SEC-B-008) | ADR-002 cutover: delete `auth.ts`, `[...nextauth]`, Drizzle | — | `tests/security/route-auth-inventory.test.ts` (no import of `@/auth`) | 4.0.3 V1.4.4, V4.1.1 | Not started |

## 3. OAuth / OIDC (T-OAUTH)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS | Status |
|---|---|---|---|---|---|---|
| T-OAUTH-01 | Login CSRF / code injection on callback | 128-bit `state` in HttpOnly SameSite=Lax 5-min cookie, required + equal, cleared after use | `AuthEvent OAUTH_STATE_MISMATCH` | `app/api/auth/google/callback/route.test.ts`, `app/api/auth/github/callback/route.test.ts` (exist) | 5.0 V10 | Verified |
| T-OAUTH-02 | Code interception | PKCE S256 (`code_verifier` in the state cookie payload) | — | same files (extend) | 5.0 V10 | Not started |
| T-OAUTH-03 | Linking via unverified provider email | Google `email_verified === true`; GitHub `selectVerifiedEmail` | — | same files (exist) | 5.0 V10 | Verified |
| T-OAUTH-04 | ID token claim confusion | Validate `iss ∈ {accounts.google.com, https://accounts.google.com}`, `aud === GOOGLE_CLIENT_ID`, `exp` | — | `lib/auth/google-oauth.test.ts` (extend) | 5.0 V10 | Not started |
| T-OAUTH-05 | Duplicate/shadow accounts on email change | Lookup by provider id first | — | callback tests (exist) | 5.0 V10 | Verified |
| T-OAUTH-06 | Token theft at rest (SEC-B-017) | ADR-011 AES-256-GCM, 96-bit IV, `v1:` prefix, key from `TOKEN_ENCRYPTION_KEY` | Decrypt failure → `AuthEvent TOKEN_DECRYPT_FAILED` | `lib/crypto/token-cipher.test.ts`, `tests/security/token-at-rest.test.ts` | 4.0.3 V6.1.1, V6.2.1; 5.0 V11 | Not started |
| T-OAUTH-07 | Token leakage via job state / logs | Inngest step returns user ids only (`daily-briefing.ts:42-47`); refresh errors describe shape not values (`refresh-token.ts:114-127`) | — | `inngest/daily-briefing.test.ts`, `lib/integrations/google/refresh-token.test.ts` (exist) | 4.0.3 V7.1.1 | Verified |
| T-OAUTH-08 | Over-broad scope | Keep `calendar.readonly`, `gmail.readonly`, `gmail.compose` (ADR-011); no `gmail.send` | — | `lib/auth/google-oauth.test.ts` (assert exact scope string) | 5.0 V10 | Implemented |
| T-OAUTH-09 | Open redirect after OAuth | Fixed `Location: /today` | — | callback tests | 4.0.3 V5.1.5 | Verified |

## 4. Authorization / BOLA (T-BOLA)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS | Status |
|---|---|---|---|---|---|---|
| T-BOLA-01 | Cross-user task access | `userId` in every `where` (`lib/tasks/queries.ts:16,25,34,43,47`); target `lib/tasks/repo.ts` with `updateMany({ id, userId, version })` (ADR-006) | 404 rate per user | `lib/tasks/queries.test.ts` (exists, needs DB); `tests/security/bola.test.ts` | 4.0.3 V4.2.1, V4.1.3; 5.0 V8 | Implemented |
| T-BOLA-02 | Cross-user memory access | `WHERE user_id = ${userId}` parameterised (`lib/memory/queries.ts:34`) | — | `lib/memory/queries.test.ts` (exists, needs DB); `tests/security/bola.test.ts` | 4.0.3 V4.2.1 | Implemented |
| T-BOLA-03 | Cross-user proposal confirm | `ProposedAction` lookup `{ id, userId, status: 'PENDING' }` | — | `app/api/command/confirm/route.test.ts` | 4.0.3 V4.2.1 | Not started |
| T-BOLA-04 | Direct Prisma use bypassing repos | ESLint `no-restricted-imports` for `@/lib/prisma` outside `lib/**/repo.ts`, `lib/auth/**` | CI lint | `pnpm lint` + `tests/security/lint-rules.test.ts` | 4.0.3 V1.4.4; 5.0 V8 | Not started |
| T-BOLA-05 | Briefing read for wrong user | `dailyBriefings.userId = session.user.id` (`app/(app)/today/page.tsx`) | — | `tests/security/bola.test.ts` | 4.0.3 V4.2.1 | Implemented |
| T-BOLA-06 | Background job wrong user context | Per-user event payload `{ userId }`, `concurrency.key = event.data.userId` (ADR-010); token lookup and data reads keyed on the same Prisma user id | — | `inngest/briefing.user-context.test.ts` | 5.0 V8 | Not started |

## 5. AI pipeline (T-PI, T-AGENCY)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS / other | Status |
|---|---|---|---|---|---|---|
| T-PI-01 | Injected instructions in email/calendar/web/memory (SEC-B-012) | Delimited `<untrusted_data>` blocks with escaping; system prompt rule | `AgentRun.taintedSources` recorded | `tests/security/prompt-injection.test.ts` | OWASP LLM01 | Not started |
| T-PI-02 | Injection triggers mutation | Run-level taint forces `requires_confirmation` (ADR-007 §5) | Count of tainted proposals rejected by user | `tests/security/prompt-injection.test.ts`, `lib/commands/policy.test.ts` | OWASP LLM01, LLM06 | Not started |
| T-PI-03 | Exfiltration via draft / web query | Drafts always confirmed with verbatim recipients; unknown recipients flagged; tainted runs cannot call `search_web` | — | `tests/security/prompt-injection.test.ts` | OWASP LLM02, LLM06 | Not started |
| T-PI-04 | Briefing poisoning (SEC-B-014) | Typed items with `sources[]` verified server-side; ungrounded dropped; links rendered as text (ADR-010) | `BriefingRun` dropped-item count | `inngest/daily-briefing.grounding.test.ts` | OWASP LLM01, LLM09 | Not started |
| T-PI-05 | Stored injection via memory | `save_memory` in tainted run requires confirmation; memory returned as untrusted data | — | `tests/security/prompt-injection.test.ts` | OWASP LLM01 | Not started |
| T-AGENCY-01 | Model executes mutations directly (SEC-B-012) | Propose tools only; `lib/commands/policy.ts` decides | — | `lib/commands/policy.test.ts` | OWASP LLM06; 5.0 V8 | Not started |
| T-AGENCY-02 | Retry re-applies mutation (SEC-B-015) | `AgentRun @@unique([userId, clientRequestId])`; proposal id idempotency key | — | `app/api/command/route.replay.test.ts` | 4.0.3 V11.1.1 | Not started |
| T-AGENCY-03 | Model-invented dates | `chrono-node` resolution server-side (ADR-008) | — | `lib/dates/resolve.test.ts` | — | Not started |
| T-AGENCY-04 | Capability creep | No DB/shell/fs/arbitrary-network tools (ADR-009); tool registry snapshot | — | `lib/ai/tools/index.test.ts` (exists; extend with name snapshot) | OWASP LLM06 | Implemented |
| T-AGENCY-05 | Draft header injection (SEC-B-013) | Zod `email()` per recipient, reject CR/LF, RFC 2047 subject | — | `lib/integrations/gmail/client.test.ts` (extend) | 4.0.3 V5.1.3 | Not started |

## 6. Web / injection (T-INJ)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS | Status |
|---|---|---|---|---|---|---|
| T-INJ-01 | CSRF on cookie-auth POST | `SameSite=Lax` on session cookie | — | `tests/security/cookie-flags.test.ts` | 4.0.3 V3.4.3, V4.2.2 | Implemented |
| T-INJ-02 | Login/unauthenticated CSRF via `text/plain` (SEC-B-010) | `assertSameOrigin(req)` (Origin, then `Sec-Fetch-Site`) + `Content-Type: application/json` required on all POST | `AuthEvent CSRF_BLOCKED` | `tests/security/csrf-origin.test.ts` | 4.0.3 V4.2.2, V13.2.3; 5.0 V3 | Not started |
| T-INJ-03 | Open redirect via `callbackUrl` (SEC-B-011) | `safeCallback()` accepts `^/(?!/)` without `\` | — | `app/sign-in/safe-callback.test.ts` | 4.0.3 V5.1.5 | Not started |
| T-INJ-04 | XSS | React escaping; no `dangerouslySetInnerHTML` [verified grep]; CSP nonce + `strict-dynamic` | CSP `report-to` endpoint | `tests/security/headers.test.ts`, `tests/security/no-dangerous-html.test.ts` (grep) | 4.0.3 V5.3.3, V14.4.3; 5.0 V3 | Implemented (escaping) / Not started (CSP) |
| T-INJ-05 | Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | — | `tests/security/headers.test.ts` | 4.0.3 V14.4.7 | Not started |
| T-INJ-06 | Missing transport/browser headers (SEC-B-018) | HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()` | — | `tests/security/headers.test.ts` | 4.0.3 V14.4.4–V14.4.6, V9.1.1 | Not started |
| T-INJ-07 | SQL injection | ORM + tagged-template raw SQL (`lib/memory/queries.ts:31-37`) | — | `lib/memory/queries.test.ts` | 4.0.3 V5.3.4 | Implemented |
| T-INJ-08 | LIKE wildcard injection (SEC-B-026) | Escape `%`, `_`, `\` or use Prisma `contains` with `mode: 'insensitive'` | — | `lib/tasks/repo.test.ts` | 4.0.3 V5.3.4 | Not started |
| T-INJ-09 | SSRF | Literal outbound hosts only; `WebCapability.read` not exposed as a tool | — | `tests/security/egress-allowlist.test.ts` | 4.0.3 V12.6.1; 5.0 V1 | Implemented |
| T-INJ-10 | Error leakage | Generic JSON errors; Next default 500 | — | `tests/security/error-shape.test.ts` (no stack, no Prisma messages) | 4.0.3 V7.4.1 | Implemented |
| T-INJ-11 | Validation detail leakage | Remove `parsed.error.flatten()` from signup 400 (`signup/route.ts:21`) or return field names only | — | `app/api/auth/signup/route.test.ts` | 4.0.3 V7.4.1 | Not started |

## 7. Rate limiting and cost (T-DOS)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS | Status |
|---|---|---|---|---|---|---|
| T-DOS-01 | Command spam | Upstash sliding window 30/min/user (`lib/rate-limit.ts:7`) | Upstash analytics | `lib/ai/orchestrator.test.ts` (exists: rate-limited path) | 4.0.3 V11.1.4 | Verified (mocked) |
| T-DOS-02 | Limiter fails open on timeout/env missing | Explicit `timeout`; `reason === 'timeout'` → deny in production; in-memory fail-closed fallback in dev/test (ADR-012) | Log `ratelimit_degraded` | `lib/rate-limit.test.ts` | 4.0.3 V11.1.4 | Not started |
| T-DOS-03 | Oversized prompts / cost (SEC-B-016) | Zod `input.max(2000)`; `maxOutputTokens`; per-user daily token budget | Alert on budget > 80 % | `app/api/command/route.test.ts` (extend), `lib/ai/budget.test.ts` | 4.0.3 V11.1.4 | Not started |
| T-DOS-04 | Email bombing via signup/forgot-password | Per-email + per-IP caps; Resend daily cap | Resend bounce/complaint webhooks | `lib/auth/rate-limit.test.ts` | 4.0.3 V11.1.4 | Implemented (partial: 60 s reissue throttle on forgot-password only) |
| T-DOS-05 | Unbounded challenge rows | IP limit on `passkey/auth/options`; sweep `expiresAt < now` | Table size metric | `app/api/auth/passkey/auth/options/route.test.ts` | 4.0.3 V11.1.4 | Not started |

## 8. Logging, privacy and data handling (T-LEAK)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS | Status |
|---|---|---|---|---|---|---|
| T-LEAK-01 | Secrets in logs | `lib/log.ts` redaction; ban `console.*` via ESLint outside `lib/log.ts` | Log scanning for token patterns | `lib/log.test.ts`, `tests/security/no-secret-logs.test.ts` | 4.0.3 V7.1.1, V7.1.2; 5.0 V16 | Not started (current call sites verified token-free) |
| T-LEAK-02 | No security audit trail (SEC-B-025) | `AuthEvent` written for every auth outcome (ADR-012) | Dashboard / weekly review query | `tests/security/auth-events.test.ts` | 4.0.3 V7.1.3, V7.2.1, V7.2.2 | Not started (table exists, never written) |
| T-LEAK-03 | Email content persisted in agent logs | Store ids not bodies in `AgentAction.output`; 90-day retention job | — | `lib/ai/agent-log.test.ts` | 4.0.3 V8.3.4, V8.3.8 | Not started |
| T-LEAK-04 | Authenticated responses cached | `Cache-Control: private, no-store` on `/api/**` authenticated responses | — | `tests/security/headers.test.ts` | 4.0.3 V8.2.1 | Not started |
| T-LEAK-05 | Third-party processor exposure | Provider retention settings confirmed; data minimisation in prompts | — | manual (checklist) | 4.0.3 V8.3.4 | Not started |

## 9. Supply chain (T-SUPPLY)

| Threat ID | Threat | Preventive control | Detection | Automated test (path) | ASVS | Status |
|---|---|---|---|---|---|---|
| T-SUPPLY-01 | Known-vulnerable Next.js (SEC-B-019) | `next` ≥ 15.5.27 | `pnpm audit` in CI | `scripts/ci/audit.sh` (CI job `security-audit`) | 4.0.3 V14.2.1 | Not started |
| T-SUPPLY-02 | Vulnerable transitive deps (SEC-B-020) | Move `shadcn` to devDependencies; remove Drizzle/Auth.js/`framer-motion`; `pnpm.overrides` for `undici`, `proxy-addr`, `postcss` | Renovate/Dependabot | `scripts/ci/audit.sh` | 4.0.3 V14.2.1, V14.2.4 | Not started |
| T-SUPPLY-03 | Malicious install scripts | `pnpm.onlyBuiltDependencies` allowlist (`package.json`) | — | `tests/security/package-policy.test.ts` (asserts allowlist unchanged) | 4.0.3 V14.2.4; 5.0 V15 | Implemented |
| T-SUPPLY-04 | Unpinned / drifting installs | `pnpm install --frozen-lockfile` in CI | — | CI config | 4.0.3 V14.2.1 | Not started |
| T-SUPPLY-05 | Unsigned Inngest invocations | `INNGEST_SIGNING_KEY` in Production/Preview; `INNGEST_DEV` unset | Inngest dashboard | `tests/security/env-contract.test.ts` (prod env schema requires the key) | — | Implemented by SDK default [assumption] |
| T-SUPPLY-06 | Env contract drift | Single Zod env schema (`lib/env.ts`) listing `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, OAuth ids/secrets, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `INNGEST_SIGNING_KEY`; deployment checklist regenerated from it | Build fails | `tests/security/env-contract.test.ts` | — | Not started |

---

## 10. Status summary (baseline)

| Status | Count |
|---|---|
| Verified | 15 |
| Implemented | 18 |
| Not started | 48 |
| **Total rows** | **81** |

Counts are per row (a row with a split status is counted under its first status). The release
gate in `docs/14-final-security-report.md §6` requires every row tied to a Critical or High
finding to be **Verified**.
