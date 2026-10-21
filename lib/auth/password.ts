// lib/auth/password.ts
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const SALT_ROUNDS = 12;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
// bcrypt only reads the first 72 bytes; longer inputs would be silently
// truncated, so they are rejected instead (SEC-B-022).
export const PASSWORD_MAX_BYTES = 72;

/** Policy for new passwords (sign-up, reset). */
export const NewPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((p) => Buffer.byteLength(p, 'utf8') <= PASSWORD_MAX_BYTES, {
    message: `Password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  });

/** Bound on what sign-in accepts, so a huge body cannot be fed to bcrypt. */
export const LoginPasswordSchema = z.string().min(1).max(1024);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | null = null;

/**
 * Burns the same bcrypt work as a real comparison, for code paths where there
 * is no hash to compare against (unknown email, OAuth-only account, locked
 * account). Keeps response time from revealing whether an account exists.
 */
export async function burnPasswordCheck(plain: string): Promise<false> {
  dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), SALT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash);
  return false;
}
