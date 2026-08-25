import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import bcrypt from 'bcrypt';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationToken: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
      verificationToken: { findFirst: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
      user: { update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const call = mockedPrisma.user.update.mock.calls[0][0];
    expect(call.where).toEqual({ email: 'a@b.com' });
    expect(call.data.password).not.toBe('a brand new passphrase');
    expect(call.data.sessionVersion.increment).toBe(1);
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'vt-1' } });
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

  it('rejects an incorrect code against a real unexpired token and increments attempts', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '000000', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(prisma.verificationToken.update).toHaveBeenCalledWith({ where: { id: 'vt-1' }, data: { attempts: 1 } });
    // A wrong code must never reset the password or bump sessionVersion.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects when max attempts (5) have already been reached', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      verificationToken: { findFirst: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.verificationToken.findFirst.mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', otpHash, attempts: 5, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', newPassword: 'a brand new passphrase' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    // Rejected before even checking the code — no bcrypt.compare-driven update.
    expect(prisma.verificationToken.update).not.toHaveBeenCalled();
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
