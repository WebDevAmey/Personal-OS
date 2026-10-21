-- M5: command pipeline (ADR-007): AgentRun columns, ProposedAction,
-- AgentAction.userId backfill and status TEXT → enum mapping.

-- Pre-flight (integrity check I6)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AgentAction" WHERE "status" NOT IN ('success', 'error')) THEN
    RAISE EXCEPTION 'AgentAction.status contains unexpected values; run integrity check I6 first';
  END IF;
  IF EXISTS (SELECT 1 FROM "AgentAction" a LEFT JOIN "AgentRun" r ON r."id" = a."agentRunId" WHERE r."id" IS NULL) THEN
    RAISE EXCEPTION 'AgentAction rows without an AgentRun; run integrity check I8 first';
  END IF;
END $$;

CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'AWAITING_CONFIRMATION', 'NEEDS_CLARIFICATION', 'FAILED', 'RATE_LIMITED');
CREATE TYPE "InputModality" AS ENUM ('TEXT', 'VOICE');
CREATE TYPE "RiskClass" AS ENUM ('READ', 'REVERSIBLE', 'CONSEQUENTIAL', 'DESTRUCTIVE', 'BULK', 'EXTERNAL');
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'NEEDS_CLARIFICATION', 'EXECUTING', 'EXECUTED', 'CANCELLED', 'EXPIRED', 'FAILED');
CREATE TYPE "AgentActionStatus" AS ENUM ('SUCCESS', 'ERROR');

-- AgentRun: legacy rows are finished runs → SUCCEEDED; new rows default RUNNING.
ALTER TABLE "AgentRun"
  ADD COLUMN "clarifiesRunId" TEXT,
  ADD COLUMN "clientRequestId" TEXT,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "intent" TEXT,
  ADD COLUMN "modality" "InputModality" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "model" TEXT,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "promptVersion" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "result" JSONB,
  ADD COLUMN "status" "AgentRunStatus" NOT NULL DEFAULT 'SUCCEEDED',
  ADD COLUMN "stepCount" INTEGER,
  ADD COLUMN "toolTrace" JSONB,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentRun" ALTER COLUMN "status" SET DEFAULT 'RUNNING';

-- clientRequestId is NULL on legacy rows; NULLs never collide in a unique index.
CREATE UNIQUE INDEX "AgentRun_userId_clientRequestId_key" ON "AgentRun"("userId", "clientRequestId");
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");
CREATE INDEX "AgentRun_createdAt_idx" ON "AgentRun"("createdAt");

-- ProposedAction
CREATE TABLE "ProposedAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "diff" JSONB,
    "risk" "RiskClass" NOT NULL,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetVersions" JSONB,
    "tainted" BOOLEAN NOT NULL DEFAULT false,
    "untrustedSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "confirmationReason" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposedAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProposedAction_userId_status_createdAt_idx" ON "ProposedAction"("userId", "status", "createdAt");
CREATE INDEX "ProposedAction_agentRunId_idx" ON "ProposedAction"("agentRunId");
CREATE INDEX "ProposedAction_status_expiresAt_idx" ON "ProposedAction"("status", "expiresAt");
ALTER TABLE "ProposedAction" ADD CONSTRAINT "ProposedAction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposedAction" ADD CONSTRAINT "ProposedAction_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_proposedActionId_fkey"
  FOREIGN KEY ("proposedActionId") REFERENCES "ProposedAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AgentAction: userId added nullable, backfilled from AgentRun, then NOT NULL.
ALTER TABLE "AgentAction"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "proposedActionId" TEXT,
  ADD COLUMN "durationMs" INTEGER;
UPDATE "AgentAction" a SET "userId" = r."userId" FROM "AgentRun" r WHERE r."id" = a."agentRunId";
ALTER TABLE "AgentAction" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "AgentAction" ALTER COLUMN "status" TYPE "AgentActionStatus" USING (
  CASE "status" WHEN 'success' THEN 'SUCCESS' WHEN 'error' THEN 'ERROR' END
)::"AgentActionStatus";

CREATE INDEX "AgentAction_agentRunId_idx" ON "AgentAction"("agentRunId");
CREATE INDEX "AgentAction_userId_createdAt_idx" ON "AgentAction"("userId", "createdAt");
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_proposedActionId_fkey"
  FOREIGN KEY ("proposedActionId") REFERENCES "ProposedAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
