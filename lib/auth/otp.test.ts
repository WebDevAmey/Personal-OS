// @vitest-environment node
// lib/auth/otp.ts against the real test database.
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { outbox } from '@/lib/email/transport';
import { bindingMatches, hashBinding, newBindingSecret, readSignUpPayload, sendPasswordResetOtp, sendSignUpOtp } from './otp';
import { uniqueEmail } from './test-helpers';

const payload = { passwordHash: '$2b$12$abc', name: null, bindingHash: hashBinding('secret') };

describe('sendSignUpOtp', () => {
  it('stores a hashed 6-digit OTP with a 10-minute expiry and emails the plaintext code', async () => {
    const email = uniqueEmail();
    const before = Date.now();
    await sendSignUpOtp(email, payload);

    const token = await prisma.verificationToken.findFirstOrThrow({ where: { email } });
    expect(token.type).toBe('SIGN_UP');
    expect(token.otpHash).not.toMatch(/^\d{6}$/);
    expect(token.expiresAt.getTime()).toBeGreaterThan(before + 9 * 60 * 1000);
    expect(token.expiresAt.getTime()).toBeLessThan(before + 11 * 60 * 1000);
    expect(readSignUpPayload(token.payload)).toEqual(payload);

    const mail = outbox.filter((m) => m.to === email);
    expect(mail).toHaveLength(1);
    const code = mail[0].text.match(/\b(\d{6})\b/)![1];
    expect(await bcrypt.compare(code, token.otpHash)).toBe(true);
  });
});

describe('sendPasswordResetOtp', () => {
  it('replaces any older reset code for the email (SEC-B-002)', async () => {
    const email = uniqueEmail();
    await sendPasswordResetOtp(email);
    await sendPasswordResetOtp(email);
    const tokens = await prisma.verificationToken.findMany({ where: { email, type: 'PASSWORD_RESET' } });
    expect(tokens).toHaveLength(1);
    const latest = outbox.filter((m) => m.to === email).at(-1)!;
    expect(await bcrypt.compare(latest.text.match(/\b(\d{6})\b/)![1], tokens[0].otpHash)).toBe(true);
  });
});

describe('sign-up binding', () => {
  it('matches only the secret that produced the hash', () => {
    const secret = newBindingSecret();
    expect(bindingMatches(secret, hashBinding(secret))).toBe(true);
    expect(bindingMatches(newBindingSecret(), hashBinding(secret))).toBe(false);
    expect(bindingMatches(null, hashBinding(secret))).toBe(false);
    expect(bindingMatches(secret, undefined)).toBe(false);
  });

  it('readSignUpPayload rejects malformed payloads', () => {
    expect(readSignUpPayload(null)).toBeNull();
    expect(readSignUpPayload({ passwordHash: 1 })).toBeNull();
  });
});
