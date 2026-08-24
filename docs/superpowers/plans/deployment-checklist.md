# Deployment Checklist — Personal OS V1

Everything below is scoped to this codebase (not generic advice). Steps
requiring cloud accounts/credentials are the project owner's to run; nothing
here was executed as part of writing this checklist.

## 0. Before the first deploy build — env vars must exist at BUILD time

`db/client.ts` calls `neon(process.env.DATABASE_URL!)` and
`lib/rate-limit.ts` calls `Redis.fromEnv()` **at module scope** — both run
the moment the module is imported, not lazily inside a request handler.
Next.js imports these modules while collecting page/route data during
`next build`. Verified locally by running `pnpm build` with vars unset:

- [ ] `DATABASE_URL` is set in Vercel's Project Settings → Environment
      Variables **before** the first production build is triggered — not
      just as a runtime-only value. Confirmed: with `DATABASE_URL` unset,
      `next build` hard-fails during "Collecting page data" with
      `Error: No database connection string was provided to neon()` /
      `Failed to collect page data for /api/auth/[...nextauth]`.
- [ ] `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are also set at
      build time. Confirmed: with these unset, `next build` does **not**
      hard-fail (`Redis.fromEnv()` only logs `[Upstash Redis] Unable to
      find environment variable...` warnings and the build completes) —
      but the resulting Redis client has an undefined url/token, so any
      request that hits `checkRateLimit()` at runtime (AI orchestrator,
      integration calls) will fail. Set them at build time anyway so the
      deployed build is the one you actually want serving traffic.
- [ ] All 11 vars below are set for both **Production** and **Preview**
      environments (Preview is what runs on PR/branch deploys and needs the
      same set to build).

## 1. Full env var list (from `.env.example`)

| Var | Where it's read | Notes |
|---|---|---|
| `DATABASE_URL` | `db/client.ts`, `drizzle.config.ts` | Neon **pooled** connection string (the `-pooler` host), not the direct one |
| `AUTH_SECRET` | Auth.js (`auth.ts`), env-convention | `npx auth secret` or `openssl rand -base64 33` |
| `AUTH_GOOGLE_ID` | Auth.js Google provider (`auth.ts`), env-convention | Google Cloud OAuth 2.0 Client ID |
| `AUTH_GOOGLE_SECRET` | Auth.js Google provider (`auth.ts`), env-convention | Google Cloud OAuth 2.0 Client secret |
| `ANTHROPIC_API_KEY` | `@ai-sdk/anthropic`, env-convention (`lib/ai/orchestrator.ts`, `inngest/daily-briefing.ts`) | model id used: `claude-sonnet-5` |
| `VOYAGE_API_KEY` | `lib/ai/embeddings.ts` (direct `fetch`) | memory embeddings |
| `TAVILY_API_KEY` | `app/api/command/route.ts` | web search tool capability |
| `UPSTASH_REDIS_REST_URL` | `lib/rate-limit.ts` `Redis.fromEnv()` | set at build time too, see §0 (missing value only warns at build, breaks at runtime) |
| `UPSTASH_REDIS_REST_TOKEN` | `lib/rate-limit.ts` `Redis.fromEnv()` | set at build time too, see §0 (missing value only warns at build, breaks at runtime) |
| `INNGEST_EVENT_KEY` | Inngest SDK, env-convention (`inngest/client.ts`) | only needed once connected to Inngest Cloud; not required against the local Inngest Dev Server |
| `INNGEST_SIGNING_KEY` | Inngest SDK, env-convention (`app/api/inngest/route.ts` `serve()`) | verifies signed requests from Inngest Cloud in production |

## 2. Infrastructure setup

- [ ] Neon project exists. **The Neon branch already used during local
      development is fully migrated** (both files in `db/migrations/` —
      `0000_greedy_lily_hollister.sql`, `0001_sharp_korvac.sql` — applied,
      `pgvector` extension created, `memories_embedding_idx` hnsw index
      applied). **This branch can be pointed to directly as
      `DATABASE_URL` in Vercel Production** — no separate migration run is
      required.
  - Only if you want an isolated prod database instead of reusing the dev
    one: create a new Neon branch/project, then run
    ```bash
    export DATABASE_URL="<new-prod-url>"
    pnpm run db:migrate
    ```
    (alias for `pnpm exec drizzle-kit migrate`)
    followed by, once, directly against that database (psql or the Neon SQL
    editor):
    ```sql
    CREATE INDEX IF NOT EXISTS memories_embedding_idx
      ON memories USING hnsw (embedding vector_cosine_ops);
    ```
- [ ] Upstash Redis database created; REST URL + token copied from the
      database's "REST API" tab in the Upstash console.
- [ ] Inngest app connected: in the Inngest dashboard, add the deployed app
      at `https://<your-domain>/api/inngest` (this is the exact route —
      see `app/api/inngest/route.ts`, which `serve()`s a single function,
      `dailyBriefingFn`). Confirm `daily-briefing` shows up as a registered
      function with its `0 8 * * *` cron schedule (`inngest/daily-briefing.ts`).
- [ ] Google Cloud OAuth consent screen configured on the same GCP project
      as the OAuth Client ID, with the Gmail API and Google Calendar API
      enabled, and **exactly** these scopes requested (copied verbatim from
      `auth.ts`'s `Google({ authorization: { params: { scope: [...] } } })`):
      - `openid`
      - `email`
      - `profile`
      - `https://www.googleapis.com/auth/gmail.readonly`
      - `https://www.googleapis.com/auth/gmail.compose`
      - `https://www.googleapis.com/auth/calendar.readonly`
      Also note `access_type: 'offline'` and `prompt: 'consent'` are set in
      the provider config — the consent screen must be able to issue a
      refresh token (i.e. not in "Testing" publishing status with the
      signing-in Google account excluded, and if the app is left in
      "Testing" mode, every account that needs to sign in must be added as
      a test user or consent will fail).

## 3. Vercel project settings

- [ ] All 11 env vars from §1 set for **Production** and **Preview**
      (see §0 — must be present before the first build runs).
- [ ] `DATABASE_URL` points at the Neon branch chosen in §2.
- [ ] `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` point at the
      Upstash database created in §2.
- [ ] `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` match the OAuth client from §2,
      and that OAuth client's "Authorized redirect URIs" includes
      `https://<your-domain>/api/auth/callback/google`.

## 4. Deploy

- [ ] `vercel --prod` — expect the build to succeed (see §0 for the most
      likely build-time failure mode) and a deployment URL to come back live.

## 5. Post-deploy smoke test (production)

1. [ ] Visit the production URL, sign in with Google, grant Gmail/Calendar
       consent.
2. [ ] Confirm a row appears in `integration_accounts` (production DB) with
       a non-null `refresh_token` (persisted by
       `lib/auth/persist-integration-account.ts` from `auth.ts`'s
       `events.signIn` handler).
3. [ ] Press Cmd+K, type "Remind me to ask Rahul about the API tomorrow",
       confirm a `memories` row is created.
4. [ ] Press Cmd+K, type "Create a task called test deployment task due
       tomorrow", confirm it appears on `/tasks`.
5. [ ] In the Inngest dashboard, manually trigger the `daily-briefing`
       function for your user and confirm `/today` renders the generated
       attention/digest items.

## 6. Known gotchas worth re-checking if something breaks

- If the build hard-fails at "Collecting page data" with a `neon()`
  connection-string error: `DATABASE_URL` is missing at build time (§0).
- If the build *succeeds* but rate-limited routes (AI orchestrator,
  integration calls) fail at runtime: check for the
  `[Upstash Redis] Unable to find environment variable` warnings in the
  build log — `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` were
  missing at build time and got baked into the deployed `Redis` client as
  undefined (§0).
- If Google sign-in succeeds but `integration_accounts.refresh_token` is
  null: the consent screen didn't actually grant a refresh token — check
  `access_type=offline` and `prompt=consent` are being sent (they're
  hardcoded in `auth.ts`) and that this isn't a repeat sign-in with a Google
  account that already granted consent once before without a token being
  re-issued (Google only returns a `refresh_token` on the first consent, or
  when `prompt=consent` forces re-consent — which it does here).
- If Inngest never shows the `daily-briefing` schedule: double-check the app
  URL registered in the Inngest dashboard is exactly
  `https://<your-domain>/api/inngest` (no trailing slash mismatch) and that
  `INNGEST_SIGNING_KEY` is set in Vercel so Inngest's request signing
  verifies.
