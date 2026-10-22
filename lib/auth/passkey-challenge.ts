// lib/auth/passkey-challenge.ts
// WebAuthn challenge storage (SEC-B-003, SEC-B-004).
//
// Sign-in (discoverable credentials, no username):
//   options → a WebAuthnChallenge row with userId NULL and a random 256-bit
//   id; the id goes into an HttpOnly cookie (`__Host-pk_chal` in production)
//   for 5 minutes, binding the challenge to the requesting browser.
//   verify → the row named by THAT cookie is deleted and returned in one
//   statement before anything is verified, so each challenge is used at most
//   once, success or failure, and no other browser's challenge can be used.
//
// Registration challenges keep userId set and are consumed the same way.
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { buildCookie, clearCookie, readAuthCookie } from './cookies';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const AUTH_CHALLENGE_COOKIE = 'pk_chal';

export async function createAuthChallenge(challenge: string): Promise<{ id: string; cookie: string }> {
  const id = randomBytes(32).toString('base64url');
  await prisma.webAuthnChallenge.create({
    data: { id, challenge, userId: null, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
  return { id, cookie: buildCookie(AUTH_CHALLENGE_COOKIE, id, { maxAgeSeconds: CHALLENGE_TTL_MS / 1000 }) };
}

export function readAuthChallengeId(req: Request): string | null {
  return readAuthCookie(req, AUTH_CHALLENGE_COOKIE);
}

export function clearAuthChallengeCookie(): string {
  return clearCookie(AUTH_CHALLENGE_COOKIE);
}

/**
 * Atomically deletes the sign-in challenge `id` and returns its value if it
 * existed and had not expired. A second call for the same id returns null.
 */
export async function consumeAuthChallenge(id: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ challenge: string; expiresAt: Date }[]>`
    DELETE FROM "WebAuthnChallenge"
    WHERE "id" = ${id} AND "userId" IS NULL
    RETURNING "challenge", "expiresAt"
  `;
  const row = rows[0];
  if (!row) return null;
  return new Date(row.expiresAt).getTime() > Date.now() ? row.challenge : null;
}

/**
 * Atomically takes the newest unexpired registration challenge for `userId`
 * (and deletes all of that user's registration challenges), so a failed
 * verification cannot be retried against the same challenge.
 */
export async function consumeRegistrationChallenge(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ challenge: string; expiresAt: Date; createdAt: Date }[]>`
    DELETE FROM "WebAuthnChallenge"
    WHERE "userId" = ${userId}
    RETURNING "challenge", "expiresAt", "createdAt"
  `;
  const live = rows
    .filter((r) => new Date(r.expiresAt).getTime() > Date.now())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return live[0]?.challenge ?? null;
}

/** Removes expired challenges (called opportunistically from the options route). */
export async function sweepExpiredChallenges(): Promise<number> {
  const result = await prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
