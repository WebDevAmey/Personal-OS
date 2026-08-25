import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import bcrypt from 'bcrypt';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationToken: { findFirst: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    user: { update: vi.fn() },
  },
}));

describe('POST /api/auth/verify-otp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks the user verified on a correct SIGN_UP code', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
      user: { update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });
    mockedPrisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockedPrisma.verificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'vt-1', attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({ where: { email: 'a@b.com' }, data: { emailVerified: true } });
    expect(mockedPrisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'vt-1' } });
  });

  it('rejects an incorrect code and atomically reserves the attempt', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });
    mockedPrisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '000000', type: 'SIGN_UP' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockedPrisma.verificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'vt-1', attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
  });

  it('rejects when no matching token exists (expired, wrong email, or already used)', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects when the atomic reservation fails (max attempts already reserved)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
      user: { update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 5, expiresAt: new Date(Date.now() + 60000),
    });
    mockedPrisma.verificationToken.updateMany.mockResolvedValue({ count: 0 });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it('caps total guesses at MAX_ATTEMPTS even under concurrent requests (atomic reservation closes the check-then-act race)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    };

    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    let attempts = 0;
    mockedPrisma.verificationToken.updateMany.mockImplementation(async () => {
      if (attempts >= 5) return { count: 0 };
      attempts += 1;
      return { count: 1 };
    });

    const bcryptCompareSpy = vi.spyOn(bcrypt, 'compare');

    const requests = Array.from({ length: 50 }, () =>
      new Request('http://localhost/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', code: '000000', type: 'SIGN_UP' }),
      }),
    );

    await Promise.all(requests.map((req) => POST(req)));

    expect(bcryptCompareSpy.mock.calls.length).toBeLessThanOrEqual(5);
    expect(attempts).toBe(5);

    bcryptCompareSpy.mockRestore();
  });

  it('returns 400 for a malformed JSON body instead of throwing', async () => {
    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
