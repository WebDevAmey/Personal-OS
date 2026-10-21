# 13 — Developer Runbook

Practical, copy-pasteable procedures for working on Personal OS locally. Production procedures
live in `docs/10-operations-and-deployment.md`; test design in `docs/09-test-strategy.md`.

Commands marked **(target)** depend on code or scripts that the V1 build adds; everything else
works against the repository as of 2026-10-21.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 22.x (verified with 22.22.0) | `node --version` |
| pnpm | 10.x (verified with 10.28.0) | `pnpm --version` (`corepack enable` if missing) |
| PostgreSQL | 16 with `pgvector` ≥ 0.6 | `psql --version`; `SELECT extversion FROM pg_extension WHERE extname='vector'` |
| Inngest dev server | via `npx inngest-cli@latest` | no global install needed |
| Chromium for E2E | Playwright build at `/opt/pw-browsers` (or `pnpm exec playwright install chromium`) | `ls /opt/pw-browsers` |

---

## 2. Local setup from scratch

### 2.1 Install

```bash
git clone <repo> aios && cd aios
pnpm install            # postinstall runs `prisma generate` → lib/generated/prisma
```

`pnpm.onlyBuiltDependencies` allows build scripts only for `@prisma/engines`, `bcrypt`,
`prisma`. If `bcrypt` fails to load, run `pnpm rebuild bcrypt`.

### 2.2 Database — option A: local Postgres + pgvector

```bash
# Debian/Ubuntu
sudo apt-get install -y postgresql-16 postgresql-16-pgvector
sudo -u postgres psql <<'SQL'
CREATE ROLE aios LOGIN PASSWORD 'aios' CREATEDB;
CREATE DATABASE aios_dev  OWNER aios;
CREATE DATABASE aios_test OWNER aios;
\c aios_dev
CREATE EXTENSION IF NOT EXISTS vector;
\c aios_test
CREATE EXTENSION IF NOT EXISTS vector;
SQL
```

Docker alternative:

```bash
docker run -d --name aios-pg -p 5432:5432 \
  -e POSTGRES_USER=aios -e POSTGRES_PASSWORD=aios -e POSTGRES_DB=aios_dev \
  pgvector/pgvector:pg16
docker exec -it aios-pg psql -U aios -c 'CREATE DATABASE aios_test' -c 'CREATE EXTENSION IF NOT EXISTS vector'
```

`CREATE EXTENSION vector` needs superuser (or `pg_database_owner` on PG ≥ 15 with the
extension marked trusted). The `aios` role above is not superuser, so the extension is created
as `postgres` once per database.

### 2.3 Database — option B: Neon

Create a Neon project, then a **branch** per developer (`dev-<name>`). Use the **pooled**
connection string (host contains `-pooler`) for `DATABASE_URL` in `.env.local`; use the
**direct** string only for running migrations. Run `CREATE EXTENSION IF NOT EXISTS vector;` in
the Neon SQL editor once per branch (inherited by child branches).

Note: `lib/prisma.ts` currently always uses `@prisma/adapter-neon`, which needs a Neon host.
Until ADR-003 lands (adapter chosen by host), **option A does not work for the running app**
— only for `psql`/migrations. After ADR-003, `localhost` URLs use `@prisma/adapter-pg`.

### 2.4 Environment

```bash
cp .env.example .env.local
```

Minimum to boot the app locally (fill values; never commit `.env.local`):

```dotenv
DATABASE_URL=postgresql://aios:aios@localhost:5432/aios_dev     # or Neon pooled URL
JWT_SECRET=<openssl rand -base64 33>                              # ≥ 32 chars, enforced at import
NEXT_PUBLIC_APP_URL=http://localhost:3000                         # no trailing slash
TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>                    # (target) ADR-011
INNGEST_DEV=1
LOG_LEVEL=debug
```

Add as needed for each feature: `GOOGLE_CLIENT_ID/SECRET` (Google sign-in + Gmail/Calendar),
`GITHUB_CLIENT_ID/SECRET`, `RESEND_API_KEY` (sign-up OTP mail), `ANTHROPIC_API_KEY` (command bar,
briefing), `VOYAGE_API_KEY` (memory), `TAVILY_API_KEY` (web search),
`UPSTASH_REDIS_REST_URL/TOKEN` (rate limits; optional locally once the ADR-012 in-memory fallback
exists — today `Redis.fromEnv()` without them makes every rate-limited call fail).

Test env — create `.env.test` (non-secret, local only):

```dotenv
DATABASE_URL=postgresql://aios:aios@localhost:5432/aios_test
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`lib/test/setup.ts` loads `.env.test` and defaults `JWT_SECRET` to a test value.

### 2.5 Migrate

```bash
# Prisma (canonical from 20260825055217_init, ADR-004)
pnpm exec prisma migrate deploy          # applies prisma/migrations to DATABASE_URL
pnpm exec prisma migrate status
DATABASE_URL=postgresql://aios:aios@localhost:5432/aios_test pnpm exec prisma migrate deploy
```

- Use `prisma migrate dev --name <change>` **only** against your local `aios_dev` when authoring a
  new migration. Never against Neon production or a shared branch.
- `pnpm db:migrate` still runs **drizzle-kit** (legacy `db/migrations`). It is removed with the
  Drizzle cutover (ADR-002); do not use it for new work.
- `prisma.config.ts` loads `.env` via `dotenv/config`, not `.env.local`. Either export
  `DATABASE_URL` in the shell (as above) or keep a local `.env` with only `DATABASE_URL`.

---

## 3. Dev commands

| Command | What |
|---|---|
| `pnpm dev` | Next dev server with Turbopack on :3000 |
| `pnpm build` / `pnpm start` | Production build (Turbopack) / serve it |
| `pnpm lint` | ESLint (baseline: 0 errors, 3 warnings in `components/ui/random-letter-swap.tsx`) |
| `pnpm exec tsc --noEmit` | Type check |
| `pnpm exec prisma studio` | Browse the DB |
| `pnpm exec prisma generate` | Regenerate client into `lib/generated/prisma` after schema edits |
| `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` | Inngest dev server UI on :8288 |

---

## 4. Test commands

| Command | What |
|---|---|
| `pnpm test` | All Vitest files once (`vitest run`) |
| `pnpm test:watch` | Watch mode |
| `pnpm exec vitest run lib/auth` | One directory |
| `pnpm exec vitest run -t "rejects update"` | By test name |
| `pnpm test:unit` / `pnpm test:int` **(target)** | Vitest projects `unit`+`dom` / `integration` (needs `aios_test` migrated) |
| `pnpm test:e2e` **(target)** | `playwright test` against a prod build with `E2E=1 AI_MODEL=mock` |
| `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm test:e2e` | Use the preinstalled Chromium |
| `pnpm test:migrations` **(target)** | Fresh DB → `migrate deploy` → drift check |

Baseline expectation today: without `DATABASE_URL`/`NEXT_PUBLIC_APP_URL`, 6 files fail at
import (tasks/memory queries, prisma, passkey/WebAuthn importers); 140/141 tests pass.

---

## 5. OAuth app configuration

All redirect URIs are built from `NEXT_PUBLIC_APP_URL` in `lib/auth/google-oauth.ts` and
`lib/auth/github-oauth.ts`, so the value must match the console entries **exactly** (scheme,
host, port, no trailing slash).

### 5.1 Google (sign-in + Gmail + Calendar)

Google Cloud Console → project → APIs & Services:

1. **Enable APIs:** Gmail API, Google Calendar API.
2. **OAuth consent screen:** External; scopes exactly (from `SCOPES` in `lib/auth/google-oauth.ts`):
   `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.readonly`,
   `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/calendar.readonly`.
   While in *Testing* status, add every account that will sign in as a test user. Gmail scopes are
   restricted: production publishing needs Google's verification.
3. **Credentials → OAuth client ID → Web application:**
   - Authorized JavaScript origins: `http://localhost:3000`, `https://<prod-domain>`
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/google/callback`
     - `https://<prod-domain>/api/auth/google/callback`
     - Legacy, only until the Auth.js removal ships: `http://localhost:3000/api/auth/callback/google`,
       `https://<prod-domain>/api/auth/callback/google`
4. Copy into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

The authorize URL sends `access_type=offline` and `prompt=consent`, so every sign-in issues a
refresh token (needed by `lib/integrations/google/refresh-token.ts`).

### 5.2 GitHub (sign-in only)

github.com → Settings → Developer settings → OAuth Apps → New OAuth App (one app per
environment; GitHub allows a single callback URL per app):

| Field | Local | Production |
|---|---|---|
| Homepage URL | `http://localhost:3000` | `https://<prod-domain>` |
| Authorization callback URL | `http://localhost:3000/api/auth/github/callback` | `https://<prod-domain>/api/auth/github/callback` |

Scopes requested by code: `read:user user:email`. Copy into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

### 5.3 Passkeys

WebAuthn RP ID is the hostname of `NEXT_PUBLIC_APP_URL` (`lib/auth/webauthn.ts`). Passkeys
registered on `localhost` do not work on any other host. Use `http://localhost:3000`, not
`127.0.0.1`, locally.

---

## 6. Inngest dev server and briefings

```bash
# terminal 1
pnpm dev
# terminal 2
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Open http://localhost:8288 → Apps should list `personal-os` with its functions (today:
`daily-briefing`; target: `briefing-scheduler`, `briefing-generate`, `reminder-fire`,
`maintenance-cleanup`). With `INNGEST_DEV=1` the SDK sends events to the dev server, and no
`INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` is needed.

### 6.1 Trigger a briefing locally

Prerequisites: a signed-in user with a Google `IntegrationAccount` row (sign in with Google once),
`ANTHROPIC_API_KEY` set.

- **Today's code:** dev server UI → Functions → `daily-briefing` → *Invoke* (runs the cron body
  for all users with integration accounts). Result rows go to the briefing table read by `/today`.
- **Target:** dev server UI → *Send event*:

  ```json
  { "name": "briefing/generate.requested",
    "data": { "userId": "<cuid from User table>", "localDate": "2026-10-22" } }
  ```

  or run the scheduler on demand: Functions → `briefing-scheduler` → *Invoke*. A second send for
  the same `userId`+`localDate` is deduplicated by design; to regenerate, delete that user's
  `BriefingRun` row for the date in your local DB first.
- Find your user id: `psql "$DATABASE_URL" -c 'select id,email from "User"'`.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error: NEXT_PUBLIC_APP_URL must be set` at build or in tests | `lib/auth/webauthn.ts` throws at module load | Set `NEXT_PUBLIC_APP_URL=http://localhost:3000` in `.env.local` and `.env.test` (and in Vercel for builds) |
| `JWT_SECRET must be set and at least 32 characters long` | `lib/auth/jwt.ts` checks at import (also runs in middleware) | `openssl rand -base64 33` (44 chars) |
| `next build` fails "Collecting page data" with `No database connection string was provided to neon()` | `db/client.ts` calls `neon(process.env.DATABASE_URL!)` at module scope | Set `DATABASE_URL` at build time; disappears when `db/` is removed (ADR-002) |
| Build log shows `[Upstash Redis] Unable to find environment variable`; build succeeds but commands fail at runtime | `Redis.fromEnv()` in `lib/rate-limit.ts` at module scope baked in undefined URL/token | Set `UPSTASH_REDIS_REST_URL`/`TOKEN` **before** building (Vercel: Production and Preview) and redeploy |
| `lib/prisma.test.ts` hangs / `The "event" argument must be an instance of Event` | Neon WebSocket driver under jsdom | File must keep `// @vitest-environment node` (or use the target `node` default project) |
| Prisma connects to Neon even with a localhost URL / connection errors on localhost | `lib/prisma.ts` hard-codes `PrismaNeon` | Use a Neon branch until ADR-003 is implemented |
| `prisma migrate deploy` uses the wrong DB | `prisma.config.ts` reads `.env` (via `dotenv/config`), not `.env.local` | `export DATABASE_URL=…` before the command |
| `ERROR: type "vector" does not exist` during migrate | `pgvector` extension not created in that DB | `CREATE EXTENSION IF NOT EXISTS vector;` as superuser in that database |
| `relation "_prisma_migrations" does not exist` when inspecting `aios_test` | Migrations never applied there | `DATABASE_URL=…/aios_test pnpm exec prisma migrate deploy` |
| Google sign-in: `redirect_uri_mismatch` | Console redirect URI ≠ `${NEXT_PUBLIC_APP_URL}/api/auth/google/callback` | Fix console entry or env value (watch `localhost` vs `127.0.0.1`, trailing slash, port) |
| Google: `access_denied` / "app not verified" | Consent screen in Testing and account not a test user | Add the account as a test user |
| `IntegrationAccount.refreshToken` is null | Consent did not issue a refresh token | Confirm `prompt=consent` + `access_type=offline` in the authorize URL; revoke app at myaccount.google.com/permissions and sign in again |
| Command bar replies "Your Google account connection has expired or is missing" for every command | Current route fetches a Google token before running any command | Sign in with Google once; target design fetches tokens lazily (`docs/04` §12) |
| Command bar: "You've hit the rate limit…" constantly | Upstash env missing → limiter call fails, or a genuine 30/min limit | Check Upstash vars; in dev use the in-memory fallback (target) |
| GitHub sign-in: `redirect_uri is not associated with this application` | GitHub OAuth App callback differs | One OAuth app per environment with the exact callback (§5.2) |
| Passkey registration fails with RP ID error | Browsing on a host different from `NEXT_PUBLIC_APP_URL` | Use exactly the configured origin |
| Sign-up OTP never arrives | `RESEND_API_KEY` missing, or sender domain `personal-os.app` not verified in your Resend account | Use Resend's test mode / verify a domain; target `EMAIL_FROM` env |
| Inngest dev UI shows no app | Dev server cannot reach `/api/inngest` | Start `pnpm dev` first; pass `-u http://localhost:3000/api/inngest` |
| Inngest Cloud 401 on `/api/inngest` | `INNGEST_SIGNING_KEY` wrong/missing for that environment | Set the key for that Vercel environment, redeploy, resync |
| Playwright: `Executable doesn't exist` | Browser revision mismatch | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` with a matching `@playwright/test` version, or set `launchOptions.executablePath` to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` |
| `bcrypt` native binding error | Build script not run | `pnpm rebuild bcrypt` |

---

## 8. Resetting local state

```bash
# local only — refuses nothing, so double-check the URL
psql postgresql://aios:aios@localhost:5432/postgres -c 'DROP DATABASE aios_dev' -c 'CREATE DATABASE aios_dev OWNER aios'
sudo -u postgres psql -d aios_dev -c 'CREATE EXTENSION IF NOT EXISTS vector'
DATABASE_URL=postgresql://aios:aios@localhost:5432/aios_dev pnpm exec prisma migrate deploy
```

Sign-out everywhere for a local user: `UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE email = '<you>';`
