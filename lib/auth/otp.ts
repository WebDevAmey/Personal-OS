// lib/auth/otp.ts
import bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sendEmail } from '@/lib/email/transport';
import { prisma } from '@/lib/prisma';
import type { Prisma, VerificationType } from '@/lib/generated/prisma/client';

export const OTP_TTL_MS = 10 * 60 * 1000;
/** Guesses allowed against one token (reserved atomically by the verifying route). */
export const OTP_MAX_ATTEMPTS = 5;

function generateOtp(): string {
  // crypto.randomInt, not Math.random: the attempt-limiting on verify-otp/
  // reset-password only bounds guessing if the code itself is unpredictable.
  // Math.random's PRNG state is recoverable from observed outputs.
  return String(randomInt(100000, 1000000));
}

/**
 * Stores a bcrypt-hashed one-time code and emails the plaintext. Any older
 * token of the same type for the email is deleted first, so only the newest
 * code is ever valid and each issuance does not add a parallel guessing
 * window (SEC-B-002).
 */
async function issueOtp(
  email: string,
  type: VerificationType,
  subject: string,
  text: (code: string) => string,
  payload?: Prisma.InputJsonValue,
): Promise<void> {
  const code = generateOtp();
  const otpHash = await bcrypt.hash(code, 10);

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { email, type } }),
    prisma.verificationToken.create({
      data: { email, type, otpHash, payload, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    }),
  ]);

  await sendEmail({ to: email, subject, text: text(code) });
}

export interface SignUpPayload {
  /** bcrypt hash of the password chosen at sign-up; applied only after OTP proof. */
  passwordHash: string;
  name?: string | null;
  /** sha256 of the HttpOnly binding cookie set on the browser that signed up. */
  bindingHash: string;
}

export async function sendSignUpOtp(email: string, payload: SignUpPayload): Promise<void> {
  await issueOtp(
    email,
    'SIGN_UP',
    'Verify your Personal OS account',
    (code) =>
      `Your verification code is ${code}. It expires in 10 minutes.\n\n` +
      'If you did not try to create a Personal OS account, ignore this email; no account is created without this code.',
    payload as unknown as Prisma.InputJsonValue,
  );
}

export async function sendPasswordResetOtp(email: string): Promise<void> {
  await issueOtp(
    email,
    'PASSWORD_RESET',
    'Reset your Personal OS password',
    (code) =>
      `Your password reset code is ${code}. It expires in 10 minutes.\n\n` +
      'If you did not ask to reset your password, you can ignore this email.',
  );
}

/** Sent instead of a code when someone signs up with an already-registered email. */
export async function sendExistingAccountNotice(email: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Sign-up attempt on your Personal OS account',
    text:
      'Someone tried to create a Personal OS account with this email address, which already has an account. ' +
      'No changes were made. If this was you, sign in instead, or use "Forgot password" to reset your password.',
  });
}

// ── Sign-up browser binding ────────────────────────────────────────────────
// The sign-up code is only accepted from the browser that submitted the
// sign-up form. Without this, a squatter could sign up with a victim's email
// and wait for the victim to type the code they were sent, which would
// activate the account with the squatter's password (SEC-B-005).

export const SIGNUP_BINDING_COOKIE = 'signup_binding';
export const SIGNUP_BINDING_MAX_AGE_SECONDS = 30 * 60;

export function newBindingSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashBinding(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function bindingMatches(secret: string | null, expectedHash: unknown): boolean {
  if (!secret || typeof expectedHash !== 'string') return false;
  const actual = Buffer.from(hashBinding(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function readSignUpPayload(value: unknown): SignUpPayload | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.passwordHash !== 'string' || typeof v.bindingHash !== 'string') return null;
  return {
    passwordHash: v.passwordHash,
    bindingHash: v.bindingHash,
    name: typeof v.name === 'string' ? v.name : null,
  };
}
