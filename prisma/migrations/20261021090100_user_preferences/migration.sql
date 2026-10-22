-- M2: UserPreference (one row per user, created with defaults).

CREATE TYPE "MotionPreference" AS ENUM ('SYSTEM', 'REDUCE', 'FULL');

CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "weekStart" INTEGER NOT NULL DEFAULT 1,
    "briefingHour" INTEGER NOT NULL DEFAULT 6,
    "briefingMinute" INTEGER NOT NULL DEFAULT 30,
    "workdayStart" TEXT,
    "workdayEnd" TEXT,
    "lunchEndsAt" TEXT,
    "reminderEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "briefingWebSearchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "speechOutputEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reducedMotion" "MotionPreference" NOT NULL DEFAULT 'SYSTEM',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "UserPreference_timeZone_idx" ON "UserPreference"("timeZone");

ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_time_check" CHECK (
  "briefingHour" BETWEEN 0 AND 23
  AND "briefingMinute" BETWEEN 0 AND 59
  AND "weekStart" BETWEEN 0 AND 6
  AND ("workdayStart" IS NULL OR "workdayStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  AND ("workdayEnd"   IS NULL OR "workdayEnd"   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  AND ("lunchEndsAt"  IS NULL OR "lunchEndsAt"  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

-- Backfill: every existing user gets a default row (integrity check I10).
INSERT INTO "UserPreference" ("userId", "updatedAt")
SELECT "id", now() FROM "User"
ON CONFLICT DO NOTHING;
