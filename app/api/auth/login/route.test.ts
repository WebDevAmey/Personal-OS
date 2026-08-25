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
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({
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
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({
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
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({
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
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({
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
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 4, lockedUntil: null,
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
    });
    await POST(req);

    const call = mockedPrisma.user.update.mock.calls[0][0];
    expect(call.data.failedLoginAttempts).toBe(5);
    expect(new Date(call.data.lockedUntil).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('rejects login while the account is locked, even with the correct password', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({
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
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 60 * 1000),
    });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    // The stale, already-expired lockedUntil must be explicitly cleared here.
    // If it isn't, it stays truthy on the row and the NEXT wrong password
    // would see it and wrongly reset the attempt budget to 0 again -- see
    // the multi-attempt regression test below for the full failure mode.
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginAttempts: 1, lockedUntil: null },
    });
  });

  it('re-locks the account after accumulating a fresh MAX_FAILED_ATTEMPTS post-expiry, proving the reset budget is not infinite', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };

    // A persisted mock: `update` actually mutates the row that `findUnique`
    // returns on the next call, so state carries across consecutive
    // requests -- a stateless one-shot mock can't expose this bug, which
    // only appears across a *sequence* of attempts.
    type MockUserRow = {
      id: string; email: string; password: string; emailVerified: boolean;
      sessionVersion: number; failedLoginAttempts: number; lockedUntil: Date | null;
    };
    let userRow: MockUserRow = {
      id: 'user-1', email: 'a@b.com', password: passwordHash, emailVerified: true,
      sessionVersion: 0, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 60 * 1000),
    };
    mockedPrisma.user.findUnique.mockImplementation(() => Promise.resolve(userRow));
    mockedPrisma.user.update.mockImplementation(({ data }: { data: Partial<MockUserRow> }) => {
      userRow = { ...userRow, ...data };
      return Promise.resolve(userRow);
    });

    const attempt = () => {
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
      });
      return POST(req);
    };

    // Attempts 1-4 post-expiry: budget resets once (to 0) and then climbs
    // normally. If the stale lockedUntil were never cleared, every one of
    // these would wrongly see a truthy lockedUntil and reset back to 0/1
    // forever, and the account would never re-lock.
    for (let i = 1; i <= 4; i++) {
      const res = await attempt();
      expect(res.status).toBe(401);
      expect(userRow.failedLoginAttempts).toBe(i);
      expect(userRow.lockedUntil).toBeNull();
    }

    // 5th fresh post-expiry failure must re-lock the account.
    const fifth = await attempt();
    expect(fifth.status).toBe(401);
    expect(userRow.failedLoginAttempts).toBe(5);
    expect(userRow.lockedUntil).not.toBeNull();
    expect((userRow.lockedUntil as Date).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

    // And a 6th attempt while newly locked must be rejected as locked (423),
    // not treated as just another wrong password.
    const sixth = await attempt();
    expect(sixth.status).toBe(423);
  });

  it('rejects login for an unverified email', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({
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
