-- M8: AuditEvent table and additive auth hardening.
-- Auth model changes are additive only (new nullable/defaulted columns,
-- indexes, a unique challenge). PasskeyCredential.counter stays INTEGER
-- here; widening it to BIGINT changes the generated TS type and is left to
-- the auth workstream (docs/03 §7.2 note).

-- AuditEvent (non-auth data mutations; written inside the mutating tx)
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "agentRunId" TEXT,
    "proposalId" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AuthEvent
ALTER TABLE "AuthEvent" ADD COLUMN "requestId" TEXT;
DROP INDEX IF EXISTS "AuthEvent_userId_idx";
DROP INDEX IF EXISTS "AuthEvent_email_idx";
CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent"("userId", "createdAt");
CREATE INDEX "AuthEvent_email_createdAt_idx" ON "AuthEvent"("email", "createdAt");
CREATE INDEX "AuthEvent_createdAt_idx" ON "AuthEvent"("createdAt");

-- WebAuthnChallenge: purpose + binding, unique challenge, owner FK.
CREATE TYPE "WebAuthnPurpose" AS ENUM ('REGISTRATION', 'AUTHENTICATION');
ALTER TABLE "WebAuthnChallenge"
  ADD COLUMN "bindingHash" TEXT,
  ADD COLUMN "purpose" "WebAuthnPurpose" NOT NULL DEFAULT 'REGISTRATION';
-- Challenges are 5-minute ephemera: drop expired rows, orphans and duplicates
-- before adding the constraints.
DELETE FROM "WebAuthnChallenge" WHERE "expiresAt" < now();
DELETE FROM "WebAuthnChallenge" c
WHERE c."userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = c."userId");
DELETE FROM "WebAuthnChallenge" c USING "WebAuthnChallenge" d
WHERE c."challenge" = d."challenge" AND c."createdAt" < d."createdAt";
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");
CREATE INDEX "WebAuthnChallenge_userId_purpose_idx" ON "WebAuthnChallenge"("userId", "purpose");
CREATE INDEX "WebAuthnChallenge_bindingHash_idx" ON "WebAuthnChallenge"("bindingHash");
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PasskeyCredential
ALTER TABLE "PasskeyCredential" ADD COLUMN "aaguid" TEXT;

-- VerificationToken: "newest unexpired for email+type" lookup + purge index.
DROP INDEX IF EXISTS "VerificationToken_email_type_idx";
CREATE INDEX "VerificationToken_email_type_createdAt_idx" ON "VerificationToken"("email", "type", "createdAt");
CREATE INDEX "VerificationToken_expiresAt_idx" ON "VerificationToken"("expiresAt");
