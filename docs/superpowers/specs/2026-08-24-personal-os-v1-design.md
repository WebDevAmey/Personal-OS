# Personal OS — Product & Technical Design

**Status:** Approved for implementation
**Date:** 2026-08-24
**Scope of this document:** Full product vision (roadmap-level) + fully-detailed spec for **V1: the Today screen + Command Bar core loop**.

---

## 1. Vision

A single web app that acts as an operating system for one person's day: it reads the signal already sitting in your email, calendar, and tasks; surfaces what actually needs attention; and lets you capture, reschedule, and query all of it through one command bar (type or speak), instead of navigating forms across five screens.

The product is judged by one interaction:

> User opens the app at 8am, sees what needs attention today without reading anything else, then says *"Move the thing I need to finish today to tomorrow and remind me about the recruiter email after lunch"* — and it just happens. No forms, no date pickers, no hunting through menus.

Everything else the app will ever do (a learning tracker, a personal knowledge graph, more integrations, deeper agent autonomy) is in service of making that loop better, not a parallel feature to bolt on.

## 2. Goals / Non-goals

**Goals (V1):**
- Ship a working, deployed, multi-user web app implementing the loop above.
- Typed, auditable AI tool-calling — the model never touches the database directly.
- Reliability primitives (idempotency, retries, per-user observability) in place from the first commit, not retrofitted.
- An integration abstraction that makes adding the *next* provider (Outlook, Drive, GitHub) additive, not a rewrite.

**Non-goals (V1 — explicitly deferred):**
- Mobile app, desktop app (Tauri/Electron).
- Kafka, Kubernetes, or physically-separate microservices — logical separation inside one Next.js app is enough at this scale.
- Learning tracker subsystem (topics, resources, spaced-recall prompts).
- Personal knowledge graph (`entities` / `relationships` tables).
- Calendar *write* actions (V1 reads the calendar; it doesn't move meetings).
- Outlook, Google Drive, GitHub, or any Tier 2/3 integration.
- A standalone Inbox page or Search page — the command bar and Today screen cover this need for V1.
- Multi-agent routing / sub-agent architecture.
- Team collaboration, shared workspaces, enterprise permissions.
- Offline-first behavior.

These aren't "never" — they're phase 2+ (see §4). Cutting them keeps V1 shippable and keeps every table/tool in this spec load-bearing.

## 3. Personas

Single persona for V1: an individual knowledge worker managing their own tasks, email, and calendar, who wants a daily briefing and a fast capture/command surface. Multi-user support (§10.1) exists so more than one such person can use the same deployment with isolated data — there is no team/shared-workspace concept yet.

## 4. Roadmap (north star — not specified in detail here)

| Phase | Adds | Trigger to start |
|---|---|---|
| **V1** (this doc) | Today screen, command bar, tasks, memory, Gmail + Calendar (read) + Web search, daily briefing | Now |
| **Phase 2** | Learning tracker (topics/resources/recall prompts), calendar write actions, Inbox page, Outlook | After V1 is in daily personal use for 2+ weeks |
| **Phase 3** | Personal knowledge graph (`entities`/`relationships`), Google Drive, GitHub, router + sub-agent orchestration (needed once tool count passes ~25-30) | After Phase 2 integrations are stable |
| **Phase 4+** | Team/shared workspaces, enterprise permissions, mobile app | Only if there's a concrete reason — not a default next step |

Each future phase gets its own brainstorming session and spec when it starts; this document does not pre-specify their schemas or APIs, to avoid designing against requirements that will have shifted by the time we get there.

---

## 5. V1 Architecture

```
                         ┌──────────────────────────┐
                         │        Browser            │
                         │  Next.js (React) + ⌘K bar │
                         │  Web Speech API (voice)   │
                         └────────────┬──────────────┘
                                      │ HTTPS
                         ┌────────────▼──────────────┐
                         │   Next.js 15 App Router    │
                         │   (Vercel, single repo)    │
                         │                            │
                         │  Route Handlers / Server   │
                         │  Actions                   │
                         │       │                    │
                         │       ▼                    │
                         │  AI Orchestrator            │
                         │  (Vercel AI SDK +           │
                         │   @ai-sdk/anthropic)        │
                         │       │                    │
                         │       ▼                    │
                         │  Typed Tool Registry (Zod)  │
                         └───┬────────┬────────┬───────┘
                             │        │        │
                 ┌───────────┘        │        └───────────┐
                 ▼                    ▼                    ▼
        ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐
        │  Neon Postgres  │  │  Upstash Redis   │  │  Capability       │
        │  + pgvector     │  │  (rate limit,    │  │  Adapters         │
        │  (Drizzle ORM)  │  │   cache)         │  │  email / calendar │
        └────────────────┘  └─────────────────┘  │  / web             │
                                                    └─────────┬─────────┘
                                                              │
                                                   Gmail API, Google Calendar
                                                   API, Web Search API
                             ┌──────────────────────────┐
                             │   Inngest                │
                             │  (scheduled + durable     │
                             │   background jobs)        │
                             │  - daily briefing gen      │
                             │  - email/calendar poll     │
                             └──────────────────────────┘
```

**Stack:**
- **Frontend:** Next.js 15 (App Router, TypeScript), React, Tailwind CSS, shadcn/ui as the structural base, [beUI](https://beui.dev) for the command palette / motion primitives, [Watermelon UI](https://ui.watermelon.sh) for dashboard/data-display components, [VengeanceUI](https://www.vengeanceui.com) for isolated animated flourishes. All three install as editable source via the shadcn registry — no hard dependency lock-in.
- **Backend:** Next.js Route Handlers + Server Actions in the same app. No separate backend service for V1.
- **Database:** Neon (serverless Postgres, pooled connections) with the `pgvector` extension. Drizzle ORM (chosen over Prisma for better fit with Neon's serverless driver and direct control over the vector index).
- **Cache / rate limiting:** Upstash Redis.
- **AI:** Claude (Anthropic) via the Vercel AI SDK's Anthropic provider — swapping/adding a model later is a config change, not a rewrite. **Embeddings:** Voyage AI (`voyage-3-lite`) — Anthropic has no first-party embeddings API and officially recommends Voyage; dimension is pinned in the initial `memories` migration once the exact model version is confirmed at implementation time.
- **Web search:** Tavily — built specifically for LLM agent tool-use, simple REST API, generous free tier. Swappable later without touching the AI layer since it sits behind the `WebCapability` interface (§7).
- **Background jobs:** Inngest — step-level retries with backoff, concurrency control, scheduled runs, and a failure dashboard.
- **Auth:** Auth.js v5, **Google as the sole V1 provider**, requesting `gmail.readonly`, `gmail.compose`, and `calendar.readonly` scopes at sign-in. One OAuth flow produces both the login session and the tokens integrations need.
- **Voice:** Web Speech API (browser-native, no audio leaves the client as raw audio, no backend cost).
- **Deployment:** Vercel (app) + Neon (DB) + Upstash (Redis) + Inngest Cloud (jobs).

## 6. AI Orchestration

**Pattern: single agent, one Claude tool-use call per command, bound to the full V1 tool registry.**

Considered and rejected for V1:
- *Router + domain sub-agents* — right once the tool count passes ~25-30 (Phase 3 territory); at 11 tools it only adds an LLM hop and complexity.
- *Deterministic intent classification with LLM fallback* — cheaper per call, but reintroduces a rigid command taxonomy, which directly contradicts "no forms, no fiddling."

**Flow:**

```
User input (text or voice transcript)
        │
        ▼
Claude (Anthropic, tool-use mode, full V1 tool registry bound)
        │
        ├── Ambiguous? (e.g. two tasks match "the assignment")
        │        └── Ask ONE clarifying question back to the user. Do not guess.
        │
        ▼
Tool call(s) selected, Zod-validated, executed with an idempotency key
        │
        ▼
Result written to `agent_actions`; user-facing confirmation returned
```

Every command-bar interaction is logged to `agent_runs` (the input, which tools were called, latency, token cost) and each individual tool invocation to `agent_actions` (inputs, outputs, idempotency key, success/failure). This is what makes a bad AI decision debuggable after the fact instead of a mystery — a deliberate reliability investment, not scope creep.

### V1 Tool Registry

| Tool | Input | Effect |
|---|---|---|
| `create_task` | `{ title, due_date?, notes? }` | Inserts a task row scoped to the calling user |
| `update_task` | `{ task_id, due_date?, title?, notes? }` | Updates a task the user owns |
| `complete_task` | `{ task_id }` | Marks a task completed |
| `delete_task` | `{ task_id }` | Soft-deletes a task |
| `search_tasks` | `{ query?, status?, due_before? }` | Returns matching tasks for disambiguation and lookups |
| `save_memory` | `{ content }` | Stores a freeform memory with its embedding |
| `search_memory` | `{ query }` | Semantic search over the user's memories via pgvector |
| `search_email` | `{ query }` | Delegates to the email capability adapter (Gmail) |
| `create_email_draft` | `{ to, subject, body }` | Delegates to the email capability adapter |
| `list_calendar_events` | `{ date_range }` | Delegates to the calendar capability adapter (read-only) |
| `search_web` | `{ query }` | Delegates to the web capability adapter |

This is the *only* surface through which the model touches user data. No tool, no mutation.

## 7. Integration Capability Abstraction

Each provider implements a narrow capability interface; the tool registry calls the interface, never a provider SDK directly:

```ts
interface EmailCapability {
  search(query: string): Promise<EmailMessage[]>;
  read(id: string): Promise<EmailMessage>;
  draft(input: { to: string; subject: string; body: string }): Promise<{ draftId: string }>;
}

interface CalendarCapability {
  search(range: DateRange): Promise<CalendarEvent[]>;
}

interface WebCapability {
  search(query: string): Promise<WebResult[]>;
  read(url: string): Promise<string>;
}
```

V1 ships one implementation of each: Gmail, Google Calendar, and Tavily for web search. Adding Outlook later means writing `OutlookEmailCapability` against the same interface — the tool registry and AI orchestration layer don't change. This is the concrete mechanism behind "future-proof without premature microservices."

`WebCapability.read(url)` is used internally (by `search_web`'s result-fetching and by the daily digest step) to pull full page content behind a search hit — it is not exposed as its own top-level AI tool in V1's registry (§6); nothing in the V1 UX asks the agent to fetch an arbitrary URL on its own.

## 8. Today Screen & Daily Briefing

An Inngest scheduled function runs once per user each morning:

1. Pull unread/important email via the Gmail adapter.
2. Pull today's calendar events via the Calendar adapter.
3. Pull open/overdue tasks.
4. Generate a short "what needs your attention" list and a "things to know" digest (Claude summarization over the pulled data, plus `web.search` for anything time-sensitive).
5. Write one row to `daily_briefings`.

The Today page reads that row (fast — no live LLM call on page load) plus a live `tasks` query. The command bar is global (⌘K, every screen) for capture and mutation. There is no "Learning" section on the V1 Today screen — that's Phase 2.

## 9. Data Model (V1 tables only)

```sql
-- Auth.js-managed: users, accounts, sessions, verification_tokens

integration_accounts (
  id, user_id, provider, access_token, refresh_token,
  scopes, expires_at, created_at
)

tasks (
  id, user_id, title, notes, due_date, status,
  completed_at, created_at, updated_at
)

memories (
  id, user_id, content, embedding vector(N), -- N = Voyage voyage-3-lite output dim, pinned at implementation
  created_at
)

daily_briefings (
  id, user_id, briefing_date, attention_items jsonb,
  digest_items jsonb, generated_at
)

agent_runs (
  id, user_id, input, tool_calls jsonb,
  latency_ms, token_cost, created_at
)

agent_actions (
  id, agent_run_id, tool_name, input, output,
  idempotency_key, status, created_at
)
```

No `projects`, `entities`, `relationships`, or `learning_*` tables in V1 — they're added when their phase starts, per §4. Every table above is read or written by at least one V1 tool or job; nothing here is speculative.

## 10. Auth & Security

### 10.1 Multi-user model
Every table above carries `user_id` and every Drizzle query is scoped by it at the query-builder level — cross-user data leakage isn't possible without deliberately omitting the filter, which code review (§13) checks for. No Postgres RLS for V1; app-level scoping is the enforced boundary, revisited if the data model grows more query paths.

### 10.2 Auth flow
Sign-in is "Sign in with Google" only, requesting the Gmail/Calendar scopes in the same consent screen. Session via Auth.js. No password storage in V1.

## 11. Reliability & Scaling (built in from V1, not retrofitted)

- **Idempotency:** every tool call carries an idempotency key so an Inngest retry or a double-submit from the command bar cannot double-create/double-mutate data.
- **Durable jobs:** Inngest gives step-level retries with backoff, concurrency limits, and scheduled runs for the daily briefing and any email/calendar polling — failures are visible in a dashboard, not silent.
- **Rate limiting:** Upstash Redis limits AI calls per user (cost control) and integration API calls per user (provider quota protection).
- **Connection pooling:** Neon's built-in pooler handles serverless connection scaling; no manual PgBouncer setup needed at V1 scale.
- **Observability:** every command-bar interaction and every tool call is logged (`agent_runs` / `agent_actions`) — sufficient to answer "what did the AI do and why" without server log spelunking.
- **Vector index:** pgvector index (HNSW) on `memories.embedding` from the first migration, not added after the table gets slow.

## 12. Repo Structure

```
personal-os/
├── app/
│   ├── (app)/
│   │   ├── today/
│   │   ├── tasks/
│   │   └── settings/
│   ├── api/
│   └── auth/
├── components/
│   ├── command-bar/
│   ├── tasks/
│   ├── briefing/
│   └── primitives/
├── lib/
│   ├── ai/
│   │   ├── tools/
│   │   └── prompts/
│   ├── integrations/
│   │   ├── gmail/
│   │   ├── calendar/
│   │   └── web/
│   ├── tasks/
│   └── db/
├── inngest/
│   ├── daily-briefing.ts
│   └── integration-poll.ts
├── db/
│   ├── schema/
│   └── migrations/
└── types/
```

`lib/ai/agents/`, `lib/learning/`, and similar future-phase directories are **not** pre-created — they're added when Phase 2/3 actually starts, per the brainstorming skill's guidance against unrelated/speculative structure.

## 13. Testing Strategy

TDD throughout: every tool function gets a failing test asserting the actual mutation (`expect(task.dueDate).toEqual(fridayDate)`, not "no error thrown"), then the minimal implementation, then verification. Integration adapters are tested against recorded fixtures, not live Gmail/Calendar accounts, so CI has no external dependency. Before any commit, an adversarial review pass asks: what if this tool call runs twice concurrently? What if `due_date` is null or in the past? What if the AI calls a tool with a `task_id` belonging to a different user? That last one is the one actually worth losing sleep over in a multi-user app — it's checked explicitly, every time a tool touches a row by ID.

## 14. Success Criteria for V1

The product is done with V1 when: a user opens the app in the morning, sees a generated briefing without taking any action, and can say or type a natural-language command that reschedules a task and queues a reminder — with zero forms, zero date pickers, and a visible confirmation — in one turn, without the AI guessing at an ambiguous target.

## 15. Open Questions / Risks

- **Gmail OAuth verification:** Google's OAuth consent screen requires app verification for sensitive scopes (`gmail.readonly`, `gmail.compose`) before it can serve more than ~100 test users. Fine for personal/early use; becomes a blocker if this grows beyond a small user list. Flagged, not solved here.
- **Cost control:** per-user AI rate limiting (§11) bounds worst-case spend, but no budget/alerting threshold is defined yet — worth revisiting once real usage data exists.
