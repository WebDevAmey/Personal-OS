-- M7b: follow-ups requested by WS-2 (auth).
-- 1. AuthEventType values that lib/audit/auth-events.ts still stored under the
--    closest type with metadata.event. Append-only; nothing here uses them.
ALTER TYPE "AuthEventType" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE IF NOT EXISTS 'CSRF_BLOCKED';

-- 2. WebAuthn signature counters are unsigned 32-bit (up to 2^32-1), which
--    overflows INTEGER. Widening INTEGER -> BIGINT preserves every value.
ALTER TABLE "PasskeyCredential" ALTER COLUMN "counter" TYPE BIGINT;

-- 3. AuthEvent.requestId already exists (added in 20261021090700); nothing to do.
