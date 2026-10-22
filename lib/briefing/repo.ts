// lib/briefing/repo.ts — BriefingRun / DailyBriefing persistence (docs/03,
// ADR-006, ADR-010). Every user-owned query is scoped by `userId`; the only
// cross-user reads are the scheduler's preference scan and the stale-run
// sweeps, which return ids only.
//
// The real duplicate guard is the DB: BriefingRun @@unique([userId,
// localDate]). Rows are created with INSERT … ON CONFLICT DO NOTHING and
// claimed with a conditional updateMany, so two events, two page loads or
// two workers can never produce two runs or run one twice concurrently.
import { type Tx, reader, withTransaction } from '@/lib/db/tx';
import { Prisma, type BriefingRun, type BriefingRunStatus, type BriefingTrigger, type DailyBriefing, type Task } from '@/lib/generated/prisma/client';
import { OPEN_STATUSES } from '@/lib/tasks/types';
import { floatingDate, floatingToLocalDate, type LocalDate } from '@/lib/time';
import type { SourceStatus } from './types';

export type { BriefingRun, DailyBriefing };
export type RunWithBriefing = BriefingRun & { briefing: DailyBriefing | null };

export interface PreferenceRow {
  userId: string;
  timeZone: string;
  briefingHour: number;
  briefingMinute: number;
}

/** Scheduler scan, keyset-paginated by userId. Returns schedule fields only. */
export async function listPreferencePage(afterUserId: string | null, limit = 500, opts: { tx?: Tx } = {}): Promise<PreferenceRow[]> {
  return reader(opts.tx).userPreference.findMany({
    where: afterUserId ? { userId: { gt: afterUserId } } : {},
    select: { userId: true, timeZone: true, briefingHour: true, briefingMinute: true },
    orderBy: { userId: 'asc' },
    take: Math.min(Math.max(limit, 1), 1000),
  });
}

/** Which of these (userId, localDate) pairs already have a run. Keys are `${userId}|${localDate}`. */
export async function existingRunKeys(pairs: { userId: string; localDate: LocalDate }[], opts: { tx?: Tx } = {}): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const rows = await reader(opts.tx).briefingRun.findMany({
    where: { OR: pairs.map((p) => ({ userId: p.userId, localDate: floatingDate(p.localDate) })) },
    select: { userId: true, localDate: true },
  });
  return new Set(rows.map((r) => `${r.userId}|${floatingToLocalDate(r.localDate)}`));
}

export interface PendingRunInput {
  userId: string;
  localDate: LocalDate;
  timeZone: string;
  trigger: BriefingTrigger;
  requestId?: string;
}

/**
 * Inserts PENDING runs, skipping pairs that already have one. Returns only
 * the rows this call created, so the caller emits exactly one event per
 * new run even when called concurrently.
 */
export async function createPendingRuns(rows: PendingRunInput[], opts: { tx?: Tx; now?: Date } = {}): Promise<{ userId: string; localDate: LocalDate }[]> {
  if (rows.length === 0) return [];
  const now = opts.now ?? new Date();
  const created = await reader(opts.tx).$queryRaw<{ userId: string; localDate: Date }[]>(Prisma.sql`
    INSERT INTO "BriefingRun" ("id", "userId", "localDate", "timeZone", "status", "trigger", "requestId", "createdAt", "updatedAt")
    SELECT 'brf_' || replace(gen_random_uuid()::text, '-', ''), t."userId", t."localDate"::date, t."timeZone",
           'PENDING'::"BriefingRunStatus", t."trigger"::"BriefingTrigger", t."requestId", ${now}, ${now}
    FROM unnest(
      ${rows.map((r) => r.userId)}::text[],
      ${rows.map((r) => r.localDate)}::text[],
      ${rows.map((r) => r.timeZone)}::text[],
      ${rows.map((r) => r.trigger)}::text[],
      ${rows.map((r) => r.requestId ?? null)}::text[]
    ) AS t("userId", "localDate", "timeZone", "trigger", "requestId")
    JOIN "User" u ON u."id" = t."userId"
    ON CONFLICT ("userId", "localDate") DO NOTHING
    RETURNING "userId", "localDate"`);
  return created.map((r) => ({ userId: r.userId, localDate: floatingToLocalDate(r.localDate) }));
}

export async function getRun(userId: string, localDate: LocalDate, opts: { tx?: Tx } = {}): Promise<RunWithBriefing | null> {
  return reader(opts.tx).briefingRun.findUnique({
    where: { userId_localDate: { userId, localDate: floatingDate(localDate) } },
    include: { briefing: true },
  });
}

/** Most recent briefing for a local date before `localDate` (at most `withinDays` back). */
export async function getLatestBriefingBefore(
  userId: string,
  localDate: LocalDate,
  withinDays = 7,
  opts: { tx?: Tx } = {},
): Promise<(DailyBriefing & { briefingRun: BriefingRun }) | null> {
  const before = floatingDate(localDate);
  return reader(opts.tx).dailyBriefing.findFirst({
    where: { userId, localDate: { lt: before, gte: new Date(before.getTime() - withinDays * 86_400_000) } },
    include: { briefingRun: true },
    orderBy: [{ localDate: 'desc' }, { generatedAt: 'desc' }],
  });
}

export interface ClaimInput {
  userId: string;
  localDate: LocalDate;
  timeZone: string;
  inngestRunId: string;
  trigger: BriefingTrigger;
  requestId?: string;
  now: Date;
}

/**
 * Moves the run to RUNNING for this worker. Succeeds when the row is
 * PENDING, or is already RUNNING under the same Inngest run (a retry of this
 * function run). Returns null when another worker holds it or it finished.
 */
export async function claimRun(input: ClaimInput, opts: { tx?: Tx } = {}): Promise<BriefingRun | null> {
  const db = reader(opts.tx);
  const localDate = floatingDate(input.localDate);
  // A run requested outside the scheduler/page paths (e.g. the Inngest dashboard) has no row yet.
  await createPendingRuns([{ userId: input.userId, localDate: input.localDate, timeZone: input.timeZone, trigger: input.trigger, requestId: input.requestId }], { ...opts, now: input.now });

  const own = await db.briefingRun.updateMany({
    where: { userId: input.userId, localDate, status: 'RUNNING', inngestRunId: input.inngestRunId },
    data: { updatedAt: input.now },
  });
  if (own.count === 0) {
    const res = await db.briefingRun.updateMany({
      where: { userId: input.userId, localDate, status: 'PENDING' },
      data: {
        status: 'RUNNING',
        inngestRunId: input.inngestRunId,
        attempts: { increment: 1 },
        startedAt: input.now,
        finishedAt: null,
        errorCode: null,
        timeZone: input.timeZone,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      },
    });
    if (res.count === 0) return null;
  }
  return db.briefingRun.findUnique({ where: { userId_localDate: { userId: input.userId, localDate } } });
}

export interface FinishInput {
  userId: string;
  localDate: LocalDate;
  inngestRunId: string;
  status: Extract<BriefingRunStatus, 'SUCCEEDED' | 'PARTIAL' | 'FAILED'>;
  failedSources: string[];
  sourceStatus: Record<string, SourceStatus>;
  errorCode?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  metrics: Record<string, unknown>;
  /** Written to DailyBriefing (same transaction). Omit to leave any previous briefing untouched. */
  items?: unknown[];
  now: Date;
}

/** Persists the outcome. Only the worker holding the claim can finish the run. */
export async function finishRun(input: FinishInput, opts: { tx?: Tx } = {}): Promise<boolean> {
  return withTransaction(async (tx) => {
    const localDate = floatingDate(input.localDate);
    const res = await tx.briefingRun.updateMany({
      where: { userId: input.userId, localDate, status: 'RUNNING', inngestRunId: input.inngestRunId },
      data: {
        status: input.status,
        failedSources: input.failedSources,
        sourceStatus: input.sourceStatus as unknown as Prisma.InputJsonValue,
        errorCode: input.errorCode ?? null,
        model: input.model ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        metrics: input.metrics as Prisma.InputJsonValue,
        finishedAt: input.now,
      },
    });
    if (res.count === 0) return false;
    if (input.items) {
      const run = await tx.briefingRun.findUniqueOrThrow({ where: { userId_localDate: { userId: input.userId, localDate } }, select: { id: true } });
      const items = input.items as Prisma.InputJsonValue;
      await tx.dailyBriefing.upsert({
        where: { briefingRunId: run.id },
        create: { userId: input.userId, briefingRunId: run.id, localDate, items, schemaVersion: 2, generatedAt: input.now },
        update: { items, schemaVersion: 2, generatedAt: input.now },
      });
    }
    return true;
  }, { tx: opts.tx });
}

/** Marks a PENDING/RUNNING run FAILED (retries exhausted). `errorCode` must be a class name, never a message. */
export async function markRunFailed(userId: string, localDate: LocalDate, errorCode: string, now: Date, opts: { tx?: Tx } = {}): Promise<boolean> {
  const res = await reader(opts.tx).briefingRun.updateMany({
    where: { userId, localDate: floatingDate(localDate), status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'FAILED', errorCode, finishedAt: now },
  });
  return res.count > 0;
}

export interface RequeueInput {
  userId: string;
  localDate: LocalDate;
  statuses: BriefingRunStatus[];
  /** Only when the run last changed before this instant (rate limit). */
  changedBefore: Date;
  maxAttempts: number;
  trigger: BriefingTrigger;
  requestId?: string;
}

/** Atomically puts a finished run back to PENDING. Returns the new state or null if the guard failed. */
export async function requeueRun(input: RequeueInput, opts: { tx?: Tx } = {}): Promise<BriefingRun | null> {
  const db = reader(opts.tx);
  const localDate = floatingDate(input.localDate);
  const res = await db.briefingRun.updateMany({
    where: {
      userId: input.userId,
      localDate,
      status: { in: input.statuses },
      updatedAt: { lt: input.changedBefore },
      attempts: { lt: input.maxAttempts },
    },
    data: { status: 'PENDING', trigger: input.trigger, inngestRunId: null, ...(input.requestId ? { requestId: input.requestId } : {}) },
  });
  if (res.count === 0) return null;
  return db.briefingRun.findUnique({ where: { userId_localDate: { userId: input.userId, localDate } } });
}

/** PENDING runs whose event may have been lost; touched so each is re-emitted at most once per sweep window. */
export async function claimStalePendingRuns(olderThan: Date, now: Date, limit = 500, opts: { tx?: Tx } = {}): Promise<{ userId: string; localDate: LocalDate; attempts: number }[]> {
  const rows = await reader(opts.tx).$queryRaw<{ userId: string; localDate: Date; attempts: number }[]>(Prisma.sql`
    UPDATE "BriefingRun" SET "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "BriefingRun" WHERE "status" = 'PENDING' AND "updatedAt" < ${olderThan}
      ORDER BY "updatedAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING "userId", "localDate", "attempts"`);
  return rows.map((r) => ({ userId: r.userId, localDate: floatingToLocalDate(r.localDate), attempts: r.attempts }));
}

/** RUNNING runs whose worker vanished (no heartbeat since `olderThan`) become FAILED. */
export async function failStuckRuns(olderThan: Date, now: Date, opts: { tx?: Tx } = {}): Promise<number> {
  const res = await reader(opts.tx).briefingRun.updateMany({
    where: { status: 'RUNNING', updatedAt: { lt: olderThan } },
    data: { status: 'FAILED', errorCode: 'STALE_RUN', finishedAt: now },
  });
  return res.count;
}

// ───────────────────────── context helpers ─────────────────────────

export type GoogleAccountState = 'ACTIVE' | 'NEEDS_REAUTH' | 'DISCONNECTED' | 'NONE';

export async function getGoogleAccountState(userId: string, opts: { tx?: Tx } = {}): Promise<GoogleAccountState> {
  const row = await reader(opts.tx).integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: 'google' } },
    select: { status: true },
  });
  return row?.status ?? 'NONE';
}

/** onNeedsReconnect target: the UI shows "Reconnect Google" for NEEDS_REAUTH (INT-006). */
export async function markGoogleNeedsReconnect(userId: string, now: Date = new Date(), opts: { tx?: Tx } = {}): Promise<void> {
  await reader(opts.tx).integrationAccount.updateMany({
    where: { userId, provider: 'google', status: 'ACTIVE' },
    data: { status: 'NEEDS_REAUTH', lastErrorCode: 'NEEDS_RECONNECT', lastErrorAt: now },
  });
}

/** Open, live tasks whose snooze ends inside [from, to) — they "wake" today. */
export async function listSnoozedWaking(userId: string, from: Date, to: Date, limit = 20, opts: { tx?: Tx } = {}): Promise<Task[]> {
  return reader(opts.tx).task.findMany({
    where: {
      userId,
      deletedAt: null,
      archivedAt: null,
      status: { in: [...OPEN_STATUSES] },
      snoozedUntil: { gte: from, lt: to },
    },
    orderBy: [{ snoozedUntil: 'asc' }, { id: 'asc' }],
    take: Math.min(Math.max(limit, 1), 100),
  });
}
