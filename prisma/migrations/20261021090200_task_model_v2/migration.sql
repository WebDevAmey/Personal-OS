-- M3: task model v2 (ADR-005). Hand-written in place of Prisma's generated
-- DROP COLUMN / ADD COLUMN so that existing data is preserved:
--   notes   → description   (rename, values kept)
--   dueDate → dueAt         (rename, values kept)
--   status TEXT → "TaskStatus": 'open' → TODO, 'completed' → DONE,
--   'deleted' → deletedAt set (= updatedAt) and status keeps the pre-delete
--   meaning (DONE when completedAt is set, else TODO).

-- Pre-flight (integrity check I3): abort on unknown status values instead of
-- silently mapping them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Task" WHERE "status" NOT IN ('open', 'completed', 'deleted')) THEN
    RAISE EXCEPTION 'Task.status contains unexpected values; run integrity check I3 first';
  END IF;
END $$;

-- Trigram similarity for the duplicate-title hint (FR-214).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('INBOX', 'TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "TaskSource" AS ENUM ('MANUAL', 'COMMAND', 'VOICE', 'EMAIL', 'BRIEFING');
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'FAILED');
CREATE TYPE "ReminderChannel" AS ENUM ('IN_APP', 'EMAIL');
CREATE TYPE "ActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM');
CREATE TYPE "TaskEventType" AS ENUM ('IMPORTED', 'CREATED', 'UPDATED', 'STATUS_CHANGED', 'COMPLETED', 'REOPENED', 'SNOOZED', 'MOVED', 'ARCHIVED', 'UNARCHIVED', 'DELETED', 'RESTORED', 'DEPENDENCY_ADDED', 'DEPENDENCY_REMOVED', 'REMINDER_SET', 'REMINDER_CLEARED', 'RECURRENCE_ROLLED', 'UNDONE');

-- Project
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Project_userId_archivedAt_idx" ON "Project"("userId", "archivedAt");
CREATE UNIQUE INDEX "Project_userId_name_active_key" ON "Project" ("userId", lower("name")) WHERE "deletedAt" IS NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Task: data-preserving renames
ALTER TABLE "Task" RENAME COLUMN "notes" TO "description";
ALTER TABLE "Task" RENAME COLUMN "dueDate" TO "dueAt";

ALTER TABLE "Task"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "dueHasTime" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "estimateMinutes" INTEGER,
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "recurrenceRule" TEXT,
  ADD COLUMN "recurrenceSeriesId" TEXT,
  ADD COLUMN "snoozedUntil" TIMESTAMP(3),
  ADD COLUMN "source" "TaskSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "sourceRef" TEXT,
  ADD COLUMN "startAt" TIMESTAMP(3),
  ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "timeZone" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- 'deleted' → deletedAt (best available timestamp is updatedAt).
UPDATE "Task" SET "deletedAt" = "updatedAt" WHERE "status" = 'deleted';

-- Keep the legacy value for the baseline history event below.
ALTER TABLE "Task" ADD COLUMN "_legacyStatus" TEXT;
UPDATE "Task" SET "_legacyStatus" = "status";

ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING (
  CASE "status"
    WHEN 'open'      THEN 'TODO'
    WHEN 'completed' THEN 'DONE'
    WHEN 'deleted'   THEN CASE WHEN "completedAt" IS NOT NULL THEN 'DONE' ELSE 'TODO' END
  END
)::"TaskStatus";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'TODO';

-- Legacy dueDate came from model-produced ISO datetimes; exact UTC midnight
-- is treated as a date-only (floating) deadline.
UPDATE "Task" SET "dueHasTime" = ("dueAt"::time <> TIME '00:00:00') WHERE "dueAt" IS NOT NULL;

-- Task constraints and indexes
ALTER TABLE "Task" ADD CONSTRAINT "Task_priority_check" CHECK ("priority" BETWEEN 0 AND 4);
ALTER TABLE "Task" ADD CONSTRAINT "Task_estimate_check" CHECK ("estimateMinutes" IS NULL OR "estimateMinutes" > 0);

DROP INDEX IF EXISTS "Task_userId_idx";
CREATE INDEX "Task_userId_status_dueAt_idx" ON "Task"("userId", "status", "dueAt");
CREATE INDEX "Task_userId_deletedAt_idx" ON "Task"("userId", "deletedAt");
CREATE INDEX "Task_userId_projectId_idx" ON "Task"("userId", "projectId");
CREATE INDEX "Task_userId_updatedAt_idx" ON "Task"("userId", "updatedAt");
CREATE INDEX "Task_userId_snoozedUntil_idx" ON "Task"("userId", "snoozedUntil");
CREATE INDEX "Task_userId_startAt_idx" ON "Task"("userId", "startAt");
CREATE INDEX "Task_userId_completedAt_idx" ON "Task"("userId", "completedAt");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_recurrenceSeriesId_idx" ON "Task"("recurrenceSeriesId");
CREATE INDEX "Task_userId_source_sourceRef_idx" ON "Task"("userId", "source", "sourceRef");
CREATE INDEX "Task_tags_idx" ON "Task" USING GIN ("tags");

-- Raw-SQL objects (docs/03 §5.3):
-- at most one open, non-deleted occurrence per recurrence series (FR-231)
CREATE UNIQUE INDEX "Task_recurrenceSeriesId_open_key" ON "Task" ("recurrenceSeriesId")
  WHERE "recurrenceSeriesId" IS NOT NULL
    AND "deletedAt" IS NULL
    AND "status" IN ('INBOX', 'TODO', 'IN_PROGRESS');
-- full-text search over title + description (FR-203); lib/tasks uses the same expression
CREATE INDEX "Task_search_idx" ON "Task" USING GIN (
  to_tsvector('simple'::regconfig, coalesce("title", '') || ' ' || coalesce("description", ''))
);

ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TaskDependency
CREATE TABLE "TaskDependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId", "dependsOnId"),
    CONSTRAINT "TaskDependency_no_self_check" CHECK ("taskId" <> "dependsOnId")
);
CREATE INDEX "TaskDependency_dependsOnId_idx" ON "TaskDependency"("dependsOnId");
CREATE INDEX "TaskDependency_userId_idx" ON "TaskDependency"("userId");
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnId_fkey"
  FOREIGN KEY ("dependsOnId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reminder
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "sourceRef" TEXT,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Reminder_userId_status_remindAt_idx" ON "Reminder"("userId", "status", "remindAt");
CREATE INDEX "Reminder_status_remindAt_idx" ON "Reminder"("status", "remindAt");
CREATE INDEX "Reminder_taskId_idx" ON "Reminder"("taskId");
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TaskEvent (append-only history; the undo source of truth)
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "TaskEventType" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "source" "TaskSource" NOT NULL DEFAULT 'MANUAL',
    "agentRunId" TEXT,
    "proposedActionId" TEXT,
    "operationId" TEXT,
    "batchId" TEXT,
    "revertsEventId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "taskVersion" INTEGER NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskEvent_revertsEventId_key" ON "TaskEvent"("revertsEventId");
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");
CREATE INDEX "TaskEvent_userId_createdAt_idx" ON "TaskEvent"("userId", "createdAt");
CREATE INDEX "TaskEvent_proposedActionId_idx" ON "TaskEvent"("proposedActionId");
CREATE INDEX "TaskEvent_userId_batchId_idx" ON "TaskEvent"("userId", "batchId");
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- TaskEvent_proposedActionId_fkey is added in the command pipeline migration (M5).

-- TaskOperation (idempotency ledger for task mutations)
CREATE TABLE "TaskOperation" (
    "userId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskOperation_pkey" PRIMARY KEY ("userId", "operationId")
);
CREATE INDEX "TaskOperation_createdAt_idx" ON "TaskOperation"("createdAt");
ALTER TABLE "TaskOperation" ADD CONSTRAINT "TaskOperation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Baseline history so undo/activity have a starting point.
INSERT INTO "TaskEvent" ("id", "userId", "taskId", "type", "actorType", "after", "taskVersion", "createdAt")
SELECT 'mig_' || "id", "userId", "id", 'IMPORTED', 'SYSTEM',
       jsonb_build_object('legacyStatus', "_legacyStatus", 'status', "status", 'deletedAt', "deletedAt"),
       1, now()
FROM "Task";

ALTER TABLE "Task" DROP COLUMN "_legacyStatus";
