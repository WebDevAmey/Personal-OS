// @vitest-environment node
//
// signSessionToken (via POST) uses jose, whose WebCrypto key-type checks do
// `instanceof Uint8Array`. jsdom (this project's default vitest environment)
// ships its own Uint8Array global that isn't reference-equal to Node's, so
// under jsdom that check fails with "Received an instance of Uint8Array"
// even though it is one. Same root cause documented in lib/auth/jwt.test.ts
// and lib/prisma.test.ts — forcing the Node environment for this file avoids
// it without touching the global jsdom config other tests rely on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { hashPassword } from '@/lib/auth/password';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

describe('POST /api/auth/login', () => {
  // Each test below reads `mock.calls[0]` expecting it to be the *first
  // call within that test*. Without clearing between tests, calls
  // accumulate across the whole describe block and index 0 ends up
  // pointing at a call made by an earlier test.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets a session cookie on correct credentials', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^session=/);
  });

  it('sets a session cookie with HttpOnly, SameSite=Lax, and a 30-day Max-Age', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);

    const cookie = res.headers.get('set-cookie');
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=2592000/);
  });

  it('resets failedLoginAttempts and lockedUntil on a successful login', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 3, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('rejects an incorrect password and increments failedLoginAttempts', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { failedLoginAttempts: 1 } });
  });

  it('locks the account for 15 minutes after the 5th consecutive failure', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 4, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
    });
    await POST(req);

    const call = (prisma.user.update as any).mock.calls[0][0];
    expect(call.data.failedLoginAttempts).toBe(5);
    expect(new Date(call.data.lockedUntil).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('rejects login while the account is locked, even with the correct password', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(423);
  });

  it('gives a fresh attempt budget after a lockout has expired, instead of continuing to accumulate', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 60 * 1000),
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { failedLoginAttempts: 1 } });
  });

  it('rejects login for an unverified email', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: false,
      sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'correct horse battery staple' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
