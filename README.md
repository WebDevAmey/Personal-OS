# Personal OS

A personal operating system for a knowledge worker. Two experiences sit on top
of one task engine:

- **Morning briefing.** A background job reads your tasks, Gmail and Google
  Calendar before you wake up and prepares a short, prioritised list of
  actions. Every item shows its source and says whether it is a fact or an
  inference.
- **Command bar.** Press `⌘K` / `Ctrl+K` (or use voice) and say what you want:
  "move the report to tomorrow", "show me everything due today", "draft a
  reply to the recruiter". Ambiguous requests get one clarifying question;
  bulk, destructive and external actions wait for your confirmation; every
  change is recorded and can be undone.

## Stack

Next.js 15 (App Router) · React 19 · Tailwind CSS 4 with shadcn/Base UI ·
Prisma 7 on Postgres (Neon in production, pgvector) · hand-rolled JWT sessions
with password + OTP, Google, GitHub and passkeys · Vercel AI SDK · Inngest ·
Upstash · Resend · Vitest and Playwright.

## Getting started

```bash
pnpm install
cp .env.example .env          # fill in the values you need
pnpm db:migrate               # apply Prisma migrations
pnpm dev
```

A local Postgres with the `vector` and `pg_trgm` extensions works for
development. The full setup, OAuth app configuration and Inngest dev server
are described in [docs/13-runbook.md](docs/13-runbook.md).

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | TypeScript (`NODE_OPTIONS=--max-old-space-size=8192` may be needed) |
| `pnpm lint` | ESLint, including repository import boundaries |
| `pnpm test` | Unit and integration tests (needs `DATABASE_URL` in `.env.test`) |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:integrity` | Database integrity checks |

## Documentation

| Doc | Contents |
|-----|----------|
| [00 Product spec](docs/00-product-spec.md) | Journeys, requirements, acceptance criteria |
| [01 Current-state audit](docs/01-current-state-audit.md) | Baseline before this build |
| [02 Architecture](docs/02-system-architecture.md) | Modules, flows, failure handling |
| [03 Data model](docs/03-data-model.md) | Schema, ownership, migrations |
| [04 AI agent and tools](docs/04-ai-agent-and-tool-spec.md) | Command pipeline and tool contracts |
| [05 Threat model](docs/05-security-threat-model.md) / [06 Controls](docs/06-security-controls.md) | Security design |
| [07 Design system](docs/07-ui-design-system.md) | Tokens, components, motion |
| [08 Implementation plan](docs/08-implementation-plan.md) / [11 Progress](docs/11-progress.md) | Plan and live status |
| [09 Test strategy](docs/09-test-strategy.md) | Testing approach and status |
| [10 Operations](docs/10-operations-and-deployment.md) / [13 Runbook](docs/13-runbook.md) | Deploying and running |
| [12 Decisions](docs/12-decisions.md) | Architecture decision records |
| [14 Security report](docs/14-final-security-report.md) | Findings, fixes, residual risk |

Landing-page figures are built with the [Anatomy](https://github.com/wheresryan22/anatomy)
kit (MIT); see `components/landing/figures/kit/`.
