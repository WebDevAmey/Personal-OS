import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';
import bcrypt from 'bcrypt';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationToken: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { update: vi.fn() },
  },
}));

describe('POST /api/auth/verify-otp', () => {
  it('marks the user verified on a correct SIGN_UP code', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { email: 'a@b.com' }, data: { emailVerified: true } });
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'vt-1' } });
  });

  it('rejects an incorrect code and increments attempts', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 0, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '000000', type: 'SIGN_UP' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(prisma.verificationToken.update).toHaveBeenCalledWith({ where: { id: 'vt-1' }, data: { attempts: 1 } });
  });

  it('rejects when no matching token exists (expired, wrong email, or already used)', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects when max attempts (5) have already been reached', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { prisma } = await import('@/lib/prisma');
    (prisma.verificationToken.findFirst as any).mockResolvedValue({
      id: 'vt-1', email: 'a@b.com', type: 'SIGN_UP', otpHash, attempts: 5, expiresAt: new Date(Date.now() + 60000),
    });

    const req = new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', code: '123456', type: 'SIGN_UP' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
