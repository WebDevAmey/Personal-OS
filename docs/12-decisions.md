# 12 — Architecture Decision Records

Lightweight ADRs. Each entry: context, decision, consequences. Status is one of
Proposed / Accepted / Superseded. Entries ADR-001..ADR-004 record decisions made
before this document existed (taken from `docs/superpowers/specs/*`).

---

## ADR-001 — Modular monolith on Next.js 15 (Accepted, pre-existing)

**Context.** One person, one product, one deployable. **Decision.** Keep a single
Next.js App Router app (Vercel target) with modules under `lib/<domain>/`.
No microservices, queues beyond Inngest, or Kubernetes. **Consequences.** Module
boundaries are enforced by convention and tests, not process isolation.

## ADR-002 — Prisma 7 replaces Drizzle; hand-rolled JWT auth replaces Auth.js (Accepted, pre-existing; completed here)

**Context.** `docs/superpowers/specs/2026-08-25-auth-prisma-migration-design.md`
approved the swap. At audit time the swap was ~60% done: auth routes use Prisma,
while tasks, memory, idempotency, orchestrator, briefing, `/today`, `/tasks` and
`/api/command` still use Drizzle + Auth.js `auth()`. Two session systems coexist.
**Decision.** Finish the cutover, then delete `db/`, `auth.ts`,
`app/api/auth/[...nextauth]`, `lib/auth/persist-integration-account.ts`,
`drizzle.config.ts`, and the `next-auth`, `@auth/drizzle-adapter`, `drizzle-orm`,
`drizzle-kit` dependencies. `getSession()` (`lib/auth/session.ts`) becomes the
only server-side identity source. **Consequences.** One coherent session model.

## ADR-003 — Database driver selected by URL; local Postgres for tests (Accepted)

**Context.** `lib/prisma.ts` hard-codes `@prisma/adapter-neon`, so tests cannot run
against a local Postgres and 6 of 37 test files failed at baseline without a Neon
URL. **Decision.** `lib/prisma.ts` picks `@prisma/adapter-neon` when the host
ends in `neon.tech`, otherwise `@prisma/adapter-pg`. Integration tests run against
a disposable local Postgres 16 + pgvector database (`aios_test`) migrated with
`prisma migrate deploy`. **Consequences.** New deps `@prisma/adapter-pg`, `pg`.
Production behaviour is unchanged.

## ADR-004 — Clean-slate Prisma migration is NOT assumed safe (Accepted)

**Context.** The earlier spec chose a clean-slate migration because the product
is pre-launch. We cannot see the developer's Neon database from here.
**Decision.** Prisma migrations are canonical from `20260825055217_init`
onwards. The cutover runbook (`docs/03-data-model.md` §Migration) requires an
operator to (1) take a Neon branch/backup, (2) check for any rows in the old
Drizzle tables, (3) run `prisma migrate deploy` against the branch first.
No migration is run against any remote database by this build.
**Consequences.** AUTH-009 (execute cutover) is verified locally only and is
marked as an operator step for remote environments.

## ADR-005 — Task model expansion with event history (Accepted)

**Decision.** `Task` gains: `description` (renamed from notes via migration
that preserves data), `status` enum (`INBOX`, `TODO`, `IN_PROGRESS`, `DONE`,
`CANCELLED`) plus `archivedAt` and `deletedAt` (soft delete powering undo),
`priority` (0–3, `NONE/LOW/MEDIUM/HIGH/URGENT` mapped 0–4), `dueAt` + `dueHasTime`
(date-only vs timed deadlines), `startAt`, `timeZone`, `estimateMinutes`,
`projectId`, `tags String[]`, `parentId` (subtasks), `recurrenceRule` (RFC 5545
RRULE subset) + `recurrenceSeriesId`, `snoozedUntil`, `source` enum (`MANUAL`,
`COMMAND`, `VOICE`, `EMAIL`, `BRIEFING`), `sourceRef` (email thread / event id),
`version Int` (optimistic concurrency). New tables: `Project`,
`TaskDependency (taskId, dependsOnId)`, `Reminder`, `TaskEvent` (append-only
history; the undo source of truth). Actual time tracking is a non-goal for V1.
**Consequences.** Every field has a defined behaviour in `docs/00-product-spec.md`.

## ADR-006 — Central ownership-scoped data access (Accepted)

**Decision.** All user-owned reads/writes go through `lib/<domain>/repo.ts`
functions whose first parameter is `userId` and whose Prisma `where` always
includes `userId`. Updates use `updateMany({ where: { id, userId, version } })`
and treat `count === 0` as not-found-or-conflict, so ownership is enforced in
the query itself, not by a prior read. Route handlers and AI tools never
import `@/lib/prisma` directly (enforced by an ESLint `no-restricted-imports`
rule). **Consequences.** Cross-user isolation is testable in one layer.

## ADR-007 — Command pipeline: propose → validate → (confirm) → execute (Accepted)

**Context.** The existing orchestrator lets the model call mutating tools
directly; idempotency keys are `agentRunId:toolCallId`, so a retried HTTP
request (new run) re-applies the mutation.
**Decision.**
1. The client generates a `clientRequestId` (UUID) per submitted command;
   `AgentRun` has `@@unique([userId, clientRequestId])`. A replayed request
   returns the stored result.
2. The model gets read tools plus *propose* tools. A propose tool validates
   with Zod, resolves entities server-side (`resolve_task` returns 0/1/many
   candidates), classifies risk (`READ`, `REVERSIBLE`, `CONSEQUENTIAL`,
   `DESTRUCTIVE`/`BULK`/`EXTERNAL`) and returns either `needs_clarification`
   (with candidate options) or a `ProposedAction` row.
3. Policy (`lib/commands/policy.ts`, pure code, not the model) decides:
   single reversible mutations on one unambiguously-resolved entity
   auto-execute; bulk (>1 entity), destructive, and external side-effect
   actions (email drafts) require explicit user confirmation via
   `POST /api/command/confirm { proposalId }`.
4. Execution runs in a DB transaction that writes the change, a `TaskEvent`,
   and marks the proposal `EXECUTED`; the proposal id is the idempotency key.
5. Untrusted content (email bodies, calendar descriptions, memory, web) is
   wrapped in delimited data blocks and can never create a proposal that
   auto-executes: proposals whose arguments were derived from tool output of
   an untrusted source are forced to `requires_confirmation`.
**Consequences.** The model never decides its own authorisation.

## ADR-008 — Deterministic date resolution (Accepted)

**Decision.** Natural-language dates are resolved by server code
(`chrono-node` + user preferences: time zone, workday start, "after lunch"
= `lunchEndsAt` preference if set). The model passes the user's phrase, not an
ISO timestamp, to propose tools. If chrono returns no result or several
incompatible results, or the phrase is relative to an unset preference, the
tool returns `needs_clarification`. **Consequences.** Dates are testable
without the LLM.

## ADR-009 — LLM provider abstraction (Accepted)

**Decision.** Keep Vercel AI SDK + `@ai-sdk/anthropic`. Model id comes from
`AI_MODEL` (default `claude-sonnet-5`, the id already used in the code) via
`lib/ai/provider.ts`; tests inject a mock language model
(`ai/test` `MockLanguageModelV3`/equivalent). No DB, shell, filesystem or
arbitrary network access is exposed to the model.

## ADR-010 — Morning briefing scheduling (Accepted)

**Decision.** Inngest cron runs every 15 minutes and emits one
`briefing/generate.requested` event per user whose local time (from
`UserPreference.timeZone`) has passed `briefingHour` (default 06:30 local) and
who has no `BriefingRun` for that local date. Per-user function has
`concurrency: { key: event.data.userId, limit: 1 }`, `idempotency` on
`userId-localDate`, retries 3 with backoff. `BriefingRun` (`PENDING`,
`RUNNING`, `SUCCEEDED`, `FAILED`, `PARTIAL`) has `@@unique([userId, localDate])`.
Partial source failure (e.g. Gmail down) still produces a briefing flagged
`PARTIAL` with the failed source named. Items are typed
(`{kind, title, reason, sources[], isInferred}`) and every source reference is
checked server-side against data actually fetched (ungrounded items dropped).
If the Today page loads with no briefing for today and none running, the page
enqueues the event (not a manual button) and shows a "preparing" state.

## ADR-011 — OAuth tokens encrypted at rest (Accepted)

**Decision.** `IntegrationAccount.accessToken/refreshToken` are stored as
AES-256-GCM ciphertext (`node:crypto`, random 96-bit IV, key from
`TOKEN_ENCRYPTION_KEY`, versioned `v1:` prefix to allow rotation). Calendar
scope stays `calendar.readonly`; Gmail scopes stay `gmail.readonly` +
`gmail.compose` (drafts only — no send in V1).

## ADR-012 — Auth rate limiting and audit in Postgres (Accepted)

**Decision.** Auth endpoints use the existing `RateLimitAttempt` table with an
atomic `INSERT … ON CONFLICT DO UPDATE` fixed-window counter keyed by
`route:ip` and `route:email-hash`. Every auth outcome writes an `AuthEvent`
(no passwords, OTPs, tokens; email stored, IP stored). Upstash stays for
AI/integration limits, with a fail-closed in-memory fallback when Upstash env
vars are absent in dev/test.

## ADR-013 — UI foundation: shadcn (Base UI) + Tailwind 4 + Motion (Accepted)

**Context.** The repo already uses shadcn on `@base-ui/react`, `cmdk`,
`lucide-react`, and has *both* `framer-motion` and `motion` installed.
**Decision.** Keep shadcn/Base UI as the single primitive layer and `cmdk` for
the palette. Remove `framer-motion` (duplicate of `motion`). Magic UI /
21st.dev components are copied in source form only when they add clear value;
BoardUI, Vengence UI, beui and uiarc are references, not dependencies.
Typography and the landing-page 3D are decided in `docs/07-ui-design-system.md`.

## ADR-014 — Landing-page figures built with the Anatomy skill (Accepted)

**Context.** The owner asked for 3D animations from
`github.com/wheresryan22/anatomy` (MIT). It is a Claude skill with a
zero-dependency "kit" that produces isometric SVG + WebGL figures, not an npm
package. **Decision.** Generate the landing-page figures following Anatomy's
method and kit, vendor the produced, self-contained figure code into
`components/landing/figures/` with the MIT notice, lazy-load it below the fold,
and render a static SVG under `prefers-reduced-motion`.

## ADR-015 — Voice: browser-native first (Accepted)

**Decision.** Use the Web Speech API (`SpeechRecognition`) for capture and
`speechSynthesis` for output; no audio leaves the browser via our servers.
Unsupported browsers get a clear fallback (type instead). The transcript is
always shown and editable before submission and goes through the same
`/api/command` pipeline. No continuous/background listening.

## ADR-016 — Git attribution (Accepted)

**Decision.** All commits are authored by `Amey Tarmale <ameytarmale7@gmail.com>`
with no AI co-author or session trailers. History on `personal-os-v1` was
rewritten (owner-approved, 2026-10-21) to strip 53 such trailers; originals
are kept as `backup/personal-os-v1-original` and `backup/main-original`. A
local `commit-msg` hook strips such trailers from new commits.
