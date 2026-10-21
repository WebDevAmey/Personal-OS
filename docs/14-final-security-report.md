# 14 — Final Security Report

Status: **BASELINE**. The review was done on 2026-10-21 against `personal-os-v1` @ `4bb0885`.
Every finding is **Open**. This document is updated in place as fixes land: when a fix is
merged, set its Status to Fixed, and once its regression test passes in CI, set it to Verified.
Threat and control IDs refer to `docs/05-security-threat-model.md` and
`docs/06-security-controls.md`.

## 1. Scope

In scope (every file was read in full):

- `lib/auth/**`: `jwt.ts`, `session.ts`, `cookies.ts`, `password.ts`, `otp.ts`, `webauthn.ts`,
  `google-oauth.ts`, `github-oauth.ts`, `persist-integration-account.ts`
- `app/api/auth/**`: signup, login, verify-otp, forgot-password, reset-password, google (+callback),
  github (+callback), passkey register/auth options+verify, `[...nextauth]`
- `auth.ts` (legacy Auth.js), `middleware.ts`, `next.config.ts`, `lib/rate-limit.ts`
- `lib/ai/**`: `orchestrator.ts`, `tools/index.ts`, `idempotency.ts`, `embeddings.ts`
- `app/api/command/route.ts`, `app/api/inngest/route.ts`, `inngest/**`
- `lib/integrations/**`: gmail, calendar, web (Tavily), google refresh-token, types
- `lib/memory/queries.ts`, `lib/tasks/queries.ts`
- Supporting: `app/(app)/{layout,today/page,tasks/page}.tsx`, `app/sign-in/page.tsx`,
  `app/verify-otp/page.tsx`, `prisma/schema.prisma`, `db/schema/*.ts`, `package.json`,
  `docs/superpowers/plans/deployment-checklist.md`, and `@simplewebauthn/server@13.3.2`
  `verifyAuthenticationResponse` (to check how it handles counters and ids)

Out of scope at baseline: UI components other than those listed, landing page, the
deployed environment, the Vercel/Neon/Inngest/Upstash consoles, and penetration testing of a
running instance.

## 2. Method

1. Manual code review against the checklist in the review brief: password hashing, cookie
   flags, JWT, session rotation/revocation, OTP, reset, lockout/enumeration, WebAuthn, OAuth,
   token storage/logging, CSRF, headers/CSP, SSRF, prompt injection, excessive agency,
   cross-user isolation, background-job context, log redaction, error leakage.
2. Data-flow tracing of untrusted inputs: HTTP bodies, query params, OAuth responses, email,
   calendar and web content. Each was followed to its sinks (DB, model prompt, Gmail API,
   redirects).
3. Library behaviour checked in `node_modules` where the security property depends on it
   (simplewebauthn counter logic; Upstash Ratelimit timeout semantics).
4. `pnpm audit --prod --json`, run read-only.
5. Each finding was checked against the cited lines. Severity is based on exploitability
   in the current code combined with impact. Exposure that depends on the platform is marked
   as an assumption.

No code, git state, database or environment was changed.

## 3. Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 8 |
| Medium | 12 |
| Low | 5 |
| **Total** | **26** |

The code already handles several of the harder problems well. OAuth `state` is required, and
`email_verified` and verified GitHub emails are enforced. Accounts are looked up by provider id
first. OTPs come from a CSPRNG, are bcrypt-hashed, have a TTL, and use atomic attempt
reservation. `sessionVersion` revocation works, and password reset bumps it. The JWT algorithm
is pinned. WebAuthn checks origin, RP ID and user verification. Every task and memory query is
scoped to the user. Inngest step state carries no tokens, and token values are kept out of
error messages.

The main weaknesses fall into five groups:

1. **Authentication anti-automation.** The lockout counter can be bypassed with concurrent
   requests, the reset code can be brute-forced across issuance windows, and no IP limits exist
   anywhere.
2. **Passkey sign-in ceremony design.** There is one global challenge, it is not consumed
   atomically, and every user's credentials are disclosed.
3. **Two coexisting identity systems.** There is no logout for the new one.
4. **An AI command loop with direct mutating tools.** These tools run in the same context as
   attacker-controlled email, calendar and web content.
5. **A Next.js version with a critical advisory, no security headers, and plaintext OAuth
   tokens.**

## 4. Findings

Severity scale: **Critical** means remote compromise or mass data exposure with little or no
precondition. **High** means account takeover, cross-user impact, or a high-value secret
exposed under realistic conditions. **Medium** means it needs a precondition or chaining, or
the impact is limited. **Low** means hardening.

| ID | Severity | Title | Evidence (file:line) | Recommended fix | Regression test | Status |
|---|---|---|---|---|---|---|
| SEC-B-001 | High | Lockout bypass by concurrency; no IP/global login limit | `app/api/auth/login/route.ts:33-49`: `priorAttempts` is read, then `failedLoginAttempts = priorAttempts + 1` is written as an absolute value, so N parallel wrong guesses all write `1`. Unlimited guessing in parallel batches. `RateLimitAttempt` is never used (grep). | Atomic `updateMany … { increment: 1 }` with the lock decided from the post-increment value in the same transaction; ADR-012 limiter on `login:ip` and `login:email-hash` | `app/api/auth/login/route.concurrency.test.ts` (20 parallel bad attempts against `aios_test` → account locked; correct password then rejected) | Open |
| SEC-B-002 | High | Reset-code brute force across issuance windows | `app/api/auth/forgot-password/route.ts:12,37-46` (new token every 60 s, no daily cap); `app/api/auth/reset-password/route.ts:9,39-50` (5 attempts/token); `lib/auth/otp.ts:15` (6 digits). That allows ≈7,200 guesses/day/email, ≈0.72 %/day, ≈19.5 % over 30 days. The throttle is check-then-insert (lines 37-46), so parallel requests can mint extra tokens. No IP limit. | Per-email caps (≤5 tokens and ≤10 verification attempts per 24 h, counted across tokens); invalidate older tokens on issue; atomic issuance; IP limit; consider a 128-bit emailed link token for reset | `app/api/auth/forgot-password/route.cap.test.ts`; `app/api/auth/reset-password/route.test.ts` (attempt 11 in 24 h rejected even with a fresh token) | Open |
| SEC-B-003 | High | Passkey sign-in challenge is global, not bound or atomically consumed | `app/api/auth/passkey/auth/verify/route.ts:25-28` takes the newest unexpired challenge across all users. `auth/options/route.ts:28-33` lets any anonymous caller create a newer one, so a loop of calls breaks every user's passkey sign-in. The challenge is deleted only after success (`verify:80`), not before verifying, and never on failure. A captured assertion is therefore replayable while its challenge stays newest; synced passkeys report counter 0, and `@simplewebauthn/server` skips the counter check when both counters are 0 (`verifyAuthenticationResponse.js:144`). `userHandle` is not compared to `credential.userId`, and `response.id` is not compared to the body's `credentialId`. | Return the challenge id in an HttpOnly `__Host-pk_chal` cookie; `deleteMany({ id, expiresAt > now })` must return `count === 1` **before** verifying; check `userHandle` and `response.id`; IP limit on options | `app/api/auth/passkey/auth/verify/route.test.ts` (other ceremony's challenge rejected; second use rejected; mismatched userHandle rejected) | Open |
| SEC-B-004 | Medium | Unauthenticated passkey options discloses every credential and grows a table without bound | `app/api/auth/passkey/auth/options/route.ts:11-21`: `findMany` with no `where` returns every user's credential id and transports in `allowCredentials` (the comment on lines 9-10 is wrong). Lines 28-33 insert a row per anonymous call, and there is no sweep. | `allowCredentials: []` (discoverable login); IP rate limit; sweep expired challenges | `app/api/auth/passkey/auth/options/route.test.ts` (response has no `allowCredentials` entries; 11th call/min/IP → 429) | Open |
| SEC-B-005 | High | Account squatting / pre-hijack through unverified sign-up and OAuth linking | `app/api/auth/signup/route.ts:25-33`: anyone can create an unverified password account for any email, and the real owner then gets 409 forever. `google/callback/route.ts:68,83-88` and `github/callback/route.ts:71,86-92` link the provider id into that existing row by email but keep the squatter's `password` and leave `emailVerified=false`. Today the only barrier is the `emailVerified` gate (`login/route.ts:53`). If the victim enters the signup OTP that was emailed to them (`verify-otp/route.ts:52-53`), or a later change marks OAuth-linked rows verified (an obvious "fix"), the squatter's password becomes valid on the victim's live account. | On OAuth link to a row with `emailVerified=false`: set `password=null`, `emailVerified=true`, bump `sessionVersion`. On signup for an existing unverified email: issue a fresh OTP and replace the password only after OTP proof. Expire unverified rows after 24 h. | `tests/security/pre-hijack.test.ts` (squat → Google link → squatter password login fails; squat → OTP verify by owner → squatter password fails) | Open |
| SEC-B-006 | Medium | Account enumeration | `app/api/auth/login/route.ts:22-25` returns before any bcrypt work for an unknown email (~1 ms vs ~200 ms at cost 12); `:27-28` returns 423 only for existing accounts; `app/api/auth/signup/route.ts:26-27` returns 409 "already exists". | Dummy-hash compare; one generic 401 for unknown, wrong and locked; signup always returns 200 and emails the existing owner | `tests/security/enumeration.test.ts` | Open |
| SEC-B-007 | Medium | Targeted account lockout (availability) | `app/api/auth/login/route.ts:8-9,39-40`: 5 failures from anyone lock the account for 15 min, renewable indefinitely; the lock is keyed only by account. | Progressive delay plus IP limit instead of a hard lock; passkey/OAuth still allowed; notify the owner | `app/api/auth/login/route.test.ts` (extend) | Open |
| SEC-B-008 | High | Two identity systems; protected surface mostly on legacy Auth.js | `middleware.ts:5,24` gates only `/today` and `/tasks`, by JWT signature only (`:12`, no `sessionVersion`). `app/(app)/layout.tsx:5-8`, `app/(app)/today/page.tsx`, `app/(app)/tasks/page.tsx` and `app/api/command/route.ts:15` authenticate with Auth.js `auth()` (Drizzle DB sessions, beta `next-auth@5.0.0-beta.32`). `auth.ts:14-79` still runs a second Google sign-in that writes a second plaintext token copy (`lib/auth/persist-integration-account.ts:10-25`). `inngest/daily-briefing.ts:42-47` reads user ids from the Drizzle store but fetches tokens from Prisma (`lib/integrations/google/refresh-token.ts:67`), so user context crosses namespaces (it currently fails closed). | Complete ADR-002. Every page and route calls `getSession()`. Middleware matcher is deny-by-default over the app and API, with a public allowlist. Delete Auth.js and the Drizzle token table. | `tests/security/route-auth-inventory.test.ts` (no `@/auth` import; every non-allowlisted route/page calls `getSession`) | Open |
| SEC-B-009 | Medium | No logout or session lifecycle for JWT sessions | No `/api/auth/logout` exists (route listing). `lib/auth/jwt.ts:20-24` sets a fixed 30-day `exp` with no `iss`/`aud`. The cookie is named `session`, without the `__Host-` prefix, and its flags are duplicated in 5 routes (e.g. `login/route.ts:62-63`). `sessionVersion` is not bumped on passkey registration or OAuth link. | Logout + "sign out everywhere"; `__Host-session` via one cookie builder; `iss`/`aud`; sliding 7 d / absolute 30 d; bump `sessionVersion` on credential changes | `app/api/auth/logout/route.test.ts`, `tests/security/cookie-flags.test.ts`, `lib/auth/session-rotation.test.ts` | Open |
| SEC-B-010 | Medium | CSRF on JSON endpoints (login CSRF) | All POST handlers call `req.json()` with no `Content-Type` or `Origin` check (e.g. `app/api/auth/login/route.ts:14`, `signup/route.ts:15`, `app/api/command/route.ts:20`). A cross-site `enctype="text/plain"` form can deliver valid JSON to the unauthenticated endpoints and sign the victim into the attacker's account. Authenticated routes rely only on `SameSite=Lax`. | `assertSameOrigin()` + require `application/json` on every POST | `tests/security/csrf-origin.test.ts` | Open |
| SEC-B-011 | Medium | Open redirect after sign-in | `app/sign-in/page.tsx:13,38`: `router.push(searchParams.get('callbackUrl'))` with no validation. `?callbackUrl=https://evil.example` sends the user off-site right after a successful login (phishing). | Accept only `^/(?!/)` paths without `\`; fall back to `/today` | `app/sign-in/safe-callback.test.ts` | Open |
| SEC-B-012 | High | Indirect prompt injection with excessive agency and exfiltration | `lib/ai/tools/index.ts:21-82`: `delete_task`, `complete_task`, `update_task`, `save_memory` and `create_email_draft` execute directly, in the same `generateText` loop (`lib/ai/orchestrator.ts:27-33`) that receives attacker-controlled email subjects/snippets (`gmail/client.ts:17-26`), calendar titles (`calendar/client.ts:18-24`) and web content (`web/client.ts:13`), with no delimiting or confirmation. An injected instruction can delete or complete tasks, draft an email to the attacker containing other mailbox content, put personal data into a `search_web` query sent to Tavily, or persist instructions through `save_memory`. | ADR-007 propose/policy/confirm; run-level taint forces confirmation; drafts always confirmed with recipients shown verbatim; tainted runs cannot call `search_web`; untrusted data blocks | `tests/security/prompt-injection.test.ts`, `lib/commands/policy.test.ts` | Open |
| SEC-B-013 | Medium | Email header injection in Gmail drafts | `lib/integrations/gmail/client.ts:43`: ``To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}``, where the model supplies `to`/`subject` (`tools/index.ts:79`, `z.string()` only). A CR/LF in either adds hidden `Bcc:` or other headers. Chains with SEC-B-012. | Zod `email()` per recipient, reject `\r`/`\n` in all header values, RFC 2047-encode the subject (or use a MIME builder) | `lib/integrations/gmail/client.test.ts` (CRLF subject rejected; Bcc never present) | Open |
| SEC-B-014 | Medium | Briefing prompt injection / ungrounded output | `inngest/daily-briefing.ts:28` interpolates `JSON.stringify(emails)`, events and tasks directly into the prompt. Output items are free strings (`:8-11`) shown on Today as trusted content, with no source check. | ADR-010 typed items with `sources[]` validated server-side; untrusted data blocks; render links as plain text | `inngest/daily-briefing.grounding.test.ts` | Open |
| SEC-B-015 | Medium | Retried command re-applies mutations | `lib/ai/tools/index.ts:18`: idempotency key `${agentRunId}:${toolCallId}`, and each HTTP request creates a new `agentRun` (`orchestrator.ts:23`), so a retry re-executes create/delete/draft. | ADR-007 `clientRequestId` unique per user; proposal id as the key | `app/api/command/route.replay.test.ts` | Open |
| SEC-B-016 | Medium | LLM cost abuse; rate limiter fails open | `app/api/command/route.ts:20`: untyped `input`, no length limit, no `maxOutputTokens`, no daily budget. `lib/rate-limit.ts:4-13`: `Redis.fromEnv()` with missing env breaks at runtime, and Upstash `Ratelimit` allows requests on timeout by default (`@upstash/ratelimit` `reason: "timeout"`). Auth routes send email with no per-IP cap. | Zod `input.max(2000)`; `maxOutputTokens`; per-user token budget from `result.usage`; treat `timeout` as deny in production; ADR-012 limits on email-sending routes | `app/api/command/route.test.ts` (extend), `lib/rate-limit.test.ts`, `lib/ai/budget.test.ts` | Open |
| SEC-B-017 | High | OAuth access/refresh tokens stored in plaintext | `app/api/auth/google/callback/route.ts:91-112`; `lib/integrations/google/refresh-token.ts:147-154`; legacy `lib/auth/persist-integration-account.ts:10-25`; `prisma/schema.prisma` `IntegrationAccount.accessToken/refreshToken String`. A DB read (backup, branch, SQL access) exposes Gmail read+compose for every user. | ADR-011 AES-256-GCM with `v1:` versioning; re-encrypt existing rows in the migration; never select token columns outside `lib/integrations/google/` | `lib/crypto/token-cipher.test.ts`, `tests/security/token-at-rest.test.ts` | Open |
| SEC-B-018 | Medium | No security headers | `next.config.ts:3-5` is empty and `middleware.ts` sets no headers: no CSP, HSTS, `frame-ancestors`/`X-Frame-Options` (the command bar and passkey flows can be clickjacked), `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy` (microphone for ADR-015). | `headers()` in `next.config.ts` for static headers; nonce-based CSP set in middleware | `tests/security/headers.test.ts` | Open |
| SEC-B-019 | Critical | Next.js 15.5.23 with critical advisories | `package.json` `"next": "15.5.23"`; `pnpm audit`: GHSA-2xp9-vwfh-vxw4 (critical, unauthenticated RCE in the Image Optimization API with AVIF, `<15.5.24`), GHSA-p293-qw3h-jr36 (critical, Windows hosts), GHSA-4jqv-mc3x-m676 / GHSA-mcj8-r9mp-w47p (moderate, cache poisoning, `<15.5.27`). On Vercel the image optimizer may be platform-side, so exposure there is an assumption; it is fully exposed when self-hosted. | Upgrade `next` and `eslint-config-next` to ≥ 15.5.27; CI audit gate | `scripts/ci/audit.sh` (fails on high/critical in prod deps) | Open |
| SEC-B-020 | High | Vulnerable transitive production dependencies; dev tool shipped as a runtime dependency | `pnpm audit --prod`: 3 critical / 22 high / 27 moderate / 4 low in total. Notable: `proxy-addr <2.0.8` (critical, `inngest>express`); `undici <7.29.1` (high: TLS validation bypass in BalancedPool, DoS; via `@ai-sdk/provider-utils`); `sharp` (high); `postcss` (high, source-map file read); `@modelcontextprotocol/sdk`, `braces`, `brace-expansion`, `js-yaml` (high, through `shadcn`, a CLI listed in `dependencies`); `mysql2` (high, via `drizzle-orm`). | Move `shadcn` to devDependencies; remove Drizzle, Auth.js and `framer-motion` (ADR-002, ADR-013); bump `inngest`, `ai`, `@ai-sdk/anthropic`; `pnpm.overrides` for `undici`, `proxy-addr`, `postcss` where needed | `scripts/ci/audit.sh` | Open |
| SEC-B-021 | Low | Google ID token claims not validated; no PKCE or nonce | `lib/auth/google-oauth.ts:85-89` base64-decodes the payload with no `iss`/`aud`/`exp` check (acceptable under OIDC Core §3.1.3.7 because it comes directly from the token endpoint over TLS, but brittle). `buildGoogleAuthUrl` (`:21-35`) and `buildGithubAuthUrl` (`github-oauth.ts:19-26`) send no `code_challenge`. | Validate `iss`, `aud`, `exp`; add PKCE S256 for both providers | `lib/auth/google-oauth.test.ts`, callback tests (extend) | Open |
| SEC-B-022 | Low | Password policy | `signup/route.ts:8` and `reset-password/route.ts:7` set `min(8)` with no maximum; bcrypt silently truncates at 72 bytes (`lib/auth/password.ts:6-8`); no breached-password check. | Min 12, max 128 characters / 72 bytes; optional HIBP k-anonymity check | `lib/auth/password-policy.test.ts` | Open |
| SEC-B-023 | Low | Reset leaves lockout and stale tokens | `reset-password/route.ts:55-56` resets the password but not `failedLoginAttempts`/`lockedUntil`, and deletes only the used token, so other unexpired reset tokens for the email remain. | Clear lockout fields; `deleteMany` all `PASSWORD_RESET` tokens for the email | `app/api/auth/reset-password/route.test.ts` (extend) | Open |
| SEC-B-024 | Low | Validation details returned to clients | `app/api/auth/signup/route.ts:21` returns `parsed.error.flatten()`. | Return field names only, or a generic message | `app/api/auth/signup/route.test.ts` (extend) | Open |
| SEC-B-025 | Medium | No security audit trail; unstructured logging | `AuthEvent` exists in `prisma/schema.prisma` but is never written (grep: no `authEvent.create` outside generated code). Logs are ad-hoc `console.error` calls (`app/api/command/route.ts:38,40`, `auth.ts:75`, `inngest/daily-briefing.ts:92`, `lib/ai/idempotency.ts:129`) with no redaction layer (none of them leak secrets today). `AgentRun.input` and `AgentAction.input/output` keep raw command text and tool payloads indefinitely. | ADR-012 `AuthEvent` writes; `lib/log.ts` with key redaction; retention job | `tests/security/auth-events.test.ts`, `tests/security/no-secret-logs.test.ts`, `lib/log.test.ts` | Open |
| SEC-B-026 | Low | LIKE wildcard injection in task search | `lib/tasks/queries.ts:50`: `ilike(tasks.title, \`%${filter.query}%\`)` without escaping `%`/`_`. Scoped to the user, so the only effect is broader matches and table-scan cost. | Escape wildcards, or use Prisma `contains` with `mode: 'insensitive'` in the new repo | `lib/tasks/repo.test.ts` | Open |

### 4.1 Non-security defects observed (for scheduling)

- `app/verify-otp/page.tsx:34` posts `{ email, otp, type }`, but the route expects `code`
  (`app/api/auth/verify-otp/route.ts:7`), so verification always fails with 400. `:48`
  navigates to `/reset-password?token=${data.token}`, but the route returns no token.
- `app/api/auth/passkey/auth/verify/route.ts:91-94` answers a `fetch` POST with a 307
  redirect. A 307 preserves the method, so the browser re-POSTs to `/today`.
- `docs/superpowers/plans/deployment-checklist.md` §1 does not list `JWT_SECRET`,
  `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `RESEND_API_KEY`,
  `NEXT_PUBLIC_APP_URL` or `TOKEN_ENCRYPTION_KEY`. §2 suggests pointing Production at the
  development Neon branch, which mixes development and production data. This is a security
  concern too; see residual risk R6.

## 5. Residual risks (accepted or open after the planned fixes)

| ID | Risk | Rationale / owner action |
|---|---|---|
| R1 | Prompt injection can still mislead the user's judgement (summaries, persuasive confirmation prompts) | ADR-007 removes autonomous impact; the confirmation UI must show concrete diffs |
| R2 | Third-party processors (Anthropic, Voyage, Tavily, Resend, Inngest) see personal data | Confirm retention and no-training settings per account; disclose in the privacy note |
| R3 | Compromise of both the DB and `TOKEN_ENCRYPTION_KEY` defeats ADR-011 | Keep the key only in Vercel env; rotate with the `v1:` → `v2:` scheme |
| R4 | Distributed low-rate password guessing below per-IP limits | Passkeys are encouraged; breached-password check is optional |
| R5 | New dependency advisories | CI audit gate plus Renovate |
| R6 | Shared dev/prod database, if the checklist advice is followed | Owner decision; recommend a separate Neon project for Production |
| R7 | `gmail.compose` is requested at every sign-in, not incrementally | Product decision; scope is drafts-only per ADR-011 |

## 6. Sign-off criteria

Release is blocked until all of the following hold:

1. Every Critical and High finding (SEC-B-001, -002, -003, -005, -008, -012, -017, -019,
   -020) has status **Verified**: the fix is merged and the named regression test passes in CI
   against the local Postgres (`aios_test`).
2. Every Medium finding is Verified, or is recorded in §5 as an accepted risk with the owner's
   written approval.
3. `pnpm audit --prod --audit-level=high` reports 0 high and 0 critical, or every remaining
   advisory has a documented non-reachability justification.
4. `tests/security/**` runs in CI and is green. `route-auth-inventory`, `bola`, `csrf-origin`,
   `headers`, `cookie-flags`, `prompt-injection` and `no-secret-logs` are mandatory.
5. Every row in `docs/06-security-controls.md` linked to a Critical or High finding is
   **Verified**.
6. Assumptions in `docs/05-security-threat-model.md §8` are confirmed by the owner: Inngest
   signing key, separate prod DB, and provider retention settings.
7. A security header scan of the Preview deployment shows CSP, HSTS, `frame-ancestors 'none'`,
   `nosniff`, `Referrer-Policy` and `Permissions-Policy`.
8. The legacy Auth.js and Drizzle code paths are deleted (ADR-002), and `grep -r "@/auth'"`
   over `app/` and `lib/` returns nothing.

Sign-off: _pending_ (Authentication & Security Engineer), _pending_ (project owner).
