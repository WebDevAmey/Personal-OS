import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import bcrypt from 'bcrypt';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationToken: { findFirst: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    user: { update: vi.fn() },
  },
}));

describe('POST /api/auth/reset-password', () => {
  // Shared mocks across tests in this file — clear between tests so a call
  // recorded by one test doesn't leak into the next (see login/route.test.ts).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets the password and bumps sessionVersion (signs out everywhere) on a correct code', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
      user: { update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });
    mockedPrisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockedPrisma.verificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'vt-1', attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
    const call = mockedPrisma.user.update.mock.calls[0][0];
    expect(call.where).toEqual({ email: 'a@b.com' });
    expect(call.data.password).not.toBe('a brand new passphrase');
    expect(call.data.sessionVersion.increment).toBe(1);
    expect(mockedPrisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'vt-1' } });
  });

  it('rejects an incorrect or expired code', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '000000', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects an incorrect code against a real unexpired token and atomically reserves the attempt', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
      user: { update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });
    mockedPrisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '000000', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockedPrisma.verificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'vt-1', attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
    // A wrong code must never reset the password or bump sessionVersion.
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects when the atomic reservation fails (max attempts already reserved)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
      user: { update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', otpHash, attempts: 5, expiresAt: new Date(Date.now() + 60000),
    });
    // Simulates the DB's WHERE attempts < 5 matching zero rows.
    mockedPrisma.verificationToken.updateMany.mockResolvedValue({ count: 0 });

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    // Rejected before ever reaching the success path.
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it('caps total guesses at MAX_ATTEMPTS even under concurrent requests (atomic reservation closes the check-then-act race)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    };

    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    // Simulates a real atomic `UPDATE ... WHERE attempts < 5` against one shared
    // row: only succeeds while the in-memory counter is still under the cap, and
    // the increment happens synchronously within the call (no internal await),
    // matching how a single DB row-level update can't be interleaved.
    let attempts = 0;
    mockedPrisma.verificationToken.updateMany.mockImplementation(async () => {
      if (attempts >= 5) return { count: 0 };
      attempts += 1;
      return { count: 1 };
    });

    const bcryptCompareSpy = vi.spyOn(bcrypt, 'compare');

    const requests = Array.from({ length: 50 }, () =>
      new Request('http://localhost/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', code: '000000', newPassword: 'a brand new passphrase' }),
      }),
    );

    await Promise.all(requests.map((req) => POST(req)));

    // Pre-fix behavior (check-then-act on a snapshot read) would let all 50
    // concurrent requests reach bcrypt.compare. The atomic reservation caps it.
    expect(bcryptCompareSpy.mock.calls.length).toBeLessThanOrEqual(5);
    expect(attempts).toBe(5);

    bcryptCompareSpy.mockRestore();
  });

  it('returns 400 for a malformed JSON body instead of throwing', async () => {
    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
