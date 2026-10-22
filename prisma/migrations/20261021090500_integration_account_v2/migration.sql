-- M6: IntegrationAccount v2 (ADR-011, INT-006).
-- The token-format CHECK (`v1:` ciphertext) is deliberately NOT added here:
-- it must follow the encryption script (docs/03 §7.4) and the auth
-- callbacks that write sealed tokens. See docs/03 §7.2 (M6b).

CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'DISCONNECTED');

ALTER TABLE "IntegrationAccount"
  ADD COLUMN "accountEmail" TEXT,
  ADD COLUMN "lastErrorAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" TEXT,
  ADD COLUMN "lastRefreshedAt" TIMESTAMP(3),
  ADD COLUMN "providerAccountId" TEXT,
  ADD COLUMN "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill the Google subject id from the linked user.
UPDATE "IntegrationAccount" ia
SET "providerAccountId" = u."googleId", "accountEmail" = u."email"
FROM "User" u
WHERE u."id" = ia."userId" AND ia."provider" = 'google' AND ia."providerAccountId" IS NULL;

CREATE INDEX "IntegrationAccount_provider_status_idx" ON "IntegrationAccount"("provider", "status");
