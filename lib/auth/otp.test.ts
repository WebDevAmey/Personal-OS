// lib/auth/otp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSignUpOtp } from './otp';
import { outbox } from '@/lib/email/transport';

vi.mock('@/lib/prisma', () => ({
  prisma: { verificationToken: { create: vi.fn() } },
}));

describe('sendSignUpOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outbox.length = 0;
  });

  it('stores a hashed 6-digit OTP with a 10-minute expiry and emails the plaintext code', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { create: ReturnType<typeof vi.fn> };
    };
    const before = Date.now();

    await sendSignUpOtp('a@b.com');

    expect(prisma.verificationToken.create).toHaveBeenCalledOnce();
    const call = mockedPrisma.verificationToken.create.mock.calls[0][0];
    expect(call.data.email).toBe('a@b.com');
    expect(call.data.type).toBe('SIGN_UP');
    expect(call.data.otpHash).not.toMatch(/^\d{6}$/); // must be hashed, not plaintext
    const expiresAt = new Date(call.data.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before + 9 * 60 * 1000);
    expect(expiresAt).toBeLessThan(before + 11 * 60 * 1000);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe('a@b.com');
    expect(outbox[0].text).toMatch(/\b\d{6}\b/);
  });
});
