# 11 — Progress

Live record. Newest entries first in the log. Only verified results are
recorded as passing.

## Current state

- **Branch:** `personal-os-v1`
- **Milestone:** M0–M10 complete on the branch; release readiness recorded in docs/14 §8
- **Next task:** owner sign-off and the operator steps in docs/14 §8.4 (no merge to `main` or deploy without approval)

## Verification baseline (2026-10-21)

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | 0 errors, 3 warnings (`components/ui/random-letter-swap.tsx`) |
| Unit/integration (no DB) | `pnpm test` | 31/37 files, 140/141 tests; failures need DATABASE_URL / NEXT_PUBLIC_APP_URL |
| Unit/integration (local Postgres 16 + pgvector, after ADR-003) | `pnpm test` | 35/37 files, 165/176 tests; the 11 failures are the Drizzle-backed `lib/tasks/queries.test.ts` and `lib/memory/queries.test.ts`, which use the Neon HTTP driver directly (scheduled for TASK-002 / MEM-001) |
| Prisma migrations on empty DB | `prisma migrate deploy` | pass (2 migrations) |
| Build (dummy env, after Next 15.5.28 upgrade) | `pnpm build` | pass |
| Full suite after merging data foundation, auth hardening, integrations (2026-10-22) | `pnpm test` | 68/68 files, 630/630 tests |
| Typecheck / lint (same state) | `pnpm typecheck`, `pnpm lint` | pass; 0 errors, 22 warnings (ARCH-001 import-boundary warnings on not-yet-ported Drizzle/Auth.js consumers) |
| Migrations | `prisma migrate deploy` + migration test | 12 migrations apply; data-preserving mapping test passes |
| Task view performance (10k tasks) | TASK-010 test | Today median 6.8 ms, Upcoming 7.1 ms, index scan confirmed |
| Dependency audit | `pnpm audit --prod` | 2 high remaining (`mysql2` via drizzle-orm, removed in AUTH-010; `deepmerge-ts` via prisma config, dev-time) |
| Release candidate (2026-10-22) | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` | pass; 0 lint errors, 4 warnings; 96 files, 943/943 tests |
| Browser E2E (2026-10-22) | `pnpm test:e2e` | 14/14 on the production build, three consecutive runs |
| Dependency audit (2026-10-22) | `scripts/ci/audit.sh` | no known vulnerabilities |

## Log

### 2026-10-22 (release candidate)

- Merged the AI command engine (WS-4), briefing (WS-5), tokens and landing with Anatomy figures (WS-6a), app UI,
  command palette and voice (WS-6b).
- Independent security review: no Critical or High findings in new code. Fixed SEC-R-001..006, -010, -012 and the
  antecedent bug in `lib/commands/repo.ts`.
- AUTH-010: removed Auth.js, Drizzle and their dependencies; one identity system.
- Merged the browser E2E suite: deterministic scripted model behind a double gate that refuses to boot on a
  production deployment, Playwright against `next start` behind an HTTPS proxy. Covers the 8 AM acceptance flow,
  bulk confirm and replay, voice, access control, axe, reduced motion and keyboard-only use.
- Security follow-ups: 90-day `AgentRun` retention; client IP headers trusted only behind a known proxy
  (SEC-R-013); row-bound `v2:` token encryption, plaintext refused on read, `pnpm db:encrypt-tokens` and a
  format check constraint (SEC-B-017, SEC-R-009); dependency overrides and `scripts/ci/audit.sh` with a CI
  workflow (SEC-B-020, SEC-R-010).
- Release readiness written to docs/14 §8.

### 2026-10-22

- Pushed to `WebDevAmey/Personal-OS` (repo was empty; normal first push).
- Merged integrations hardening (INT-001..006): bounded Gmail search, plain-text bodies flagged untrusted, draft-only Gmail, read-only Calendar with TZ ranges, encrypted token reads, revocation, untrusted-content wrapper. 143 tests.
- Merged auth hardening (AUTH-002..008): DB-backed auth rate limiting, AuthEvents, CSRF guard, CSP/HSTS, deny-by-default middleware, lockout race fix, sign-up pre-hijack fix, reset caps, logout + revoke-all, PKCE + Google JWKS id_token check, token encryption on write, passkey challenge binding, safe callbackUrl. 13 findings fixed pending independent review, 6 partially.
- Merged data foundation (ARCH-001/002, TASK-001..010, MEM-001/002): final schema, 10 data-preserving migrations, ownership-safe task/project/preference/memory repositories, recurrence, undo, bulk preview/apply, import-boundary lint rule.
- Lead fix: passkey counter BigInt handling.

### 2026-10-21

- AUDIT-001: found the project at `~/Desktop/AIOS`, work on worktree
  `.worktrees/personal-os-v1` (67 commits, no remote). Uncommitted WIP
  (auth pages, passkey sign-in routes, landing hero, lottie assets) committed
  as `wip: commit in-progress auth pages, passkey sign-in routes and landing hero`.
- Git attribution (owner priority 1): 53 of 67 commits had AI co-author
  trailers. Owner chose to strip them and keep the author
  `Amey Tarmale <ameytarmale7@gmail.com>`. Rewritten with
  `git filter-branch --msg-filter`; tree of the rewritten tip is identical
  to the original (empty `git diff`). Backups: `backup/personal-os-v1-original`,
  `backup/main-original` (local only, not to be pushed). A local `commit-msg`
  hook strips such trailers from future commits.
- AUDIT-004: baseline checks above.
- ADR-001..016 written (`docs/12-decisions.md`).
- ADR-003 implemented: `lib/prisma.ts` chooses Neon vs node-postgres adapter.
- Planning docs 00–14 drafted in parallel by role-specific reviewers (architect,
  product/UX, security, AI/QA/ops); lead review pending.

## Blockers

| Blocker | Impact | Workaround |
|---------|--------|------------|
| No real Google/GitHub/Anthropic/Resend/Inngest/Upstash credentials | No live integration tests | Mocks and local fixtures; operator checklist in docs/10 |
| No access to the developer's Neon database | Cannot run remote cutover | Cutover runbook in docs/03; AUTH-009 remote = operator |
