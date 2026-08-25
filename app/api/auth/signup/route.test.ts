import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/auth/otp', () => ({ sendSignUpOtp: vi.fn().mockResolvedValue(undefined) }));

describe('POST /api/auth/signup', () => {
  it('creates an unverified user and sends a sign-up OTP', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockResolvedValue({ id: 'user-1', email: 'a@b.com' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { sendSignUpOtp } = await import('@/lib/auth/otp');
    expect(sendSignUpOtp).toHaveBeenCalledWith('a@b.com');
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'a@b.com', emailVerified: false }),
    }));
  });

  it('returns 409 when the email is already registered', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'existing' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('returns 400 for a password shorter than 8 characters', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'short' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
