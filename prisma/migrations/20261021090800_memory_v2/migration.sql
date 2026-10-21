-- M9: Memory v2 (source, embedding model, soft delete, updatedAt).

CREATE TYPE "MemorySource" AS ENUM ('COMMAND', 'MANUAL', 'IMPORTED');

ALTER TABLE "Memory"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "embeddingModel" TEXT NOT NULL DEFAULT 'voyage-3-lite',
  ADD COLUMN "source" "MemorySource" NOT NULL DEFAULT 'COMMAND',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX IF EXISTS "Memory_userId_idx";
CREATE INDEX "Memory_userId_createdAt_idx" ON "Memory"("userId", "createdAt");
