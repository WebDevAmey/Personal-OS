// lib/auth/webauthn.ts
import type { Uint8Array_ } from '@simplewebauthn/server';

export const RP_NAME = 'Personal OS';

// NEXT_PUBLIC_APP_URL is compile-time inlined, so a deploy built without it
// ships an empty origin no matter what the runtime env holds. Failing here
// names the variable loudly — but only after the build phase: `next build`
// evaluates this module while collecting page data, and blocking the build
// on a runtime contract is what instrumentation.ts (assertServerEnv) is
// for. During phase-production-build the check is skipped so the build can
// finish; every other phase (dev, test, production server boot) throws.
const appOrigin = process.env.NEXT_PUBLIC_APP_URL;
if (!appOrigin && process.env.NEXT_PHASE !== 'phase-production-build') {
  throw new Error('NEXT_PUBLIC_APP_URL must be set');
}

export const ORIGIN = appOrigin ?? '';
export const RP_ID = ORIGIN ? new URL(ORIGIN).hostname : '';

// Deterministically derives a WebAuthn user handle (the `userID` passed to
// generateRegistrationOptions) from a Prisma user id, instead of letting the
// library generate fresh random bytes on every call. Registering a passkey
// twice (a second device, a retry) must embed the SAME handle in the
// credential both times -- usernameless/discoverable login looks the
// credential's user handle up directly, so a random handle per call would
// make that lookup unrecoverable. A plain UTF-8 encoding of the id (a cuid,
// well under WebAuthn's 64-byte user.id limit) is sufficient since this
// value is never treated as a secret.
export function userIdToUserHandle(userId: string): Uint8Array_ {
  return new TextEncoder().encode(userId);
}
