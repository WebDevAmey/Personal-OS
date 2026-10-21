-- M4: BriefingRun + DailyBriefing transformation (ADR-010).
-- briefingDate TEXT → localDate DATE (data preserved), one LEGACY run per
-- surviving briefing, older same-day duplicates moved to a holding table.

-- Pre-flight (integrity check I5)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DailyBriefing" WHERE "briefingDate" !~ '^\d{4}-\d{2}-\d{2}$') THEN
    RAISE EXCEPTION 'DailyBriefing.briefingDate contains non YYYY-MM-DD values; run integrity check I5 first';
  END IF;
END $$;

CREATE TYPE "BriefingRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');
CREATE TYPE "BriefingTrigger" AS ENUM ('SCHEDULED', 'PAGE_LOAD', 'RETRY', 'LEGACY');

CREATE TABLE "BriefingRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "status" "BriefingRunStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "BriefingTrigger" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failedSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceStatus" JSONB,
    "errorCode" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "metrics" JSONB,
    "inngestRunId" TEXT,
    "requestId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefingRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BriefingRun_userId_localDate_key" ON "BriefingRun"("userId", "localDate");
CREATE INDEX "BriefingRun_status_updatedAt_idx" ON "BriefingRun"("status", "updatedAt");
ALTER TABLE "BriefingRun" ADD CONSTRAINT "BriefingRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DailyBriefing: rename + cast, keep legacy string arrays.
ALTER TABLE "DailyBriefing" RENAME COLUMN "briefingDate" TO "localDate";
ALTER TABLE "DailyBriefing" ALTER COLUMN "localDate" TYPE DATE USING "localDate"::date;
ALTER TABLE "DailyBriefing"
  ALTER COLUMN "attentionItems" DROP NOT NULL,
  ALTER COLUMN "digestItems" DROP NOT NULL,
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "items" JSONB,
  ADD COLUMN "briefingRunId" TEXT;
UPDATE "DailyBriefing" SET "schemaVersion" = 1, "items" = '[]'::jsonb;

-- Legacy rows had no per-day uniqueness: keep the newest per (userId,
-- localDate); move older duplicates to a holding table (data preserved, not
-- exposed by the app). The table is only created when duplicates exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "DailyBriefing" GROUP BY "userId", "localDate" HAVING count(*) > 1
  ) THEN
    CREATE TABLE IF NOT EXISTS "_LegacyDailyBriefingDuplicate" (LIKE "DailyBriefing" INCLUDING DEFAULTS);
    WITH ranked AS (
      SELECT "id", row_number() OVER (
        PARTITION BY "userId", "localDate" ORDER BY "generatedAt" DESC, "id" DESC
      ) AS rn
      FROM "DailyBriefing"
    ), moved AS (
      DELETE FROM "DailyBriefing" d USING ranked r
      WHERE d."id" = r."id" AND r.rn > 1
      RETURNING d.*
    )
    INSERT INTO "_LegacyDailyBriefingDuplicate" SELECT * FROM moved;
  END IF;
END $$;

-- One LEGACY SUCCEEDED run per remaining briefing.
INSERT INTO "BriefingRun" ("id", "userId", "localDate", "timeZone", "status", "trigger", "finishedAt", "createdAt", "updatedAt")
SELECT 'mig_' || "id", "userId", "localDate", 'UTC', 'SUCCEEDED', 'LEGACY', "generatedAt", "generatedAt", now()
FROM "DailyBriefing";
UPDATE "DailyBriefing" SET "briefingRunId" = 'mig_' || "id";

ALTER TABLE "DailyBriefing"
  ALTER COLUMN "briefingRunId" SET NOT NULL,
  ALTER COLUMN "items" SET NOT NULL;

DROP INDEX IF EXISTS "DailyBriefing_userId_generatedAt_idx";
CREATE UNIQUE INDEX "DailyBriefing_briefingRunId_key" ON "DailyBriefing"("briefingRunId");
CREATE INDEX "DailyBriefing_userId_localDate_idx" ON "DailyBriefing"("userId", "localDate");
ALTER TABLE "DailyBriefing" ADD CONSTRAINT "DailyBriefing_briefingRunId_fkey"
  FOREIGN KEY ("briefingRunId") REFERENCES "BriefingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
