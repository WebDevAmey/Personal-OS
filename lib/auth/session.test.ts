// @vitest-environment node
//
// getSession() calls verifySessionToken(), which uses jose's WebCrypto APIs.
// Those do `instanceof Uint8Array` checks that fail under jsdom (this
// project's default vitest environment) because jsdom ships its own
// Uint8Array global that isn't reference-equal to Node's. Same root cause
// documented in lib/prisma.test.ts and lib/auth/jwt.test.ts.
import { describe, it, expect, vi } from 'vitest';
import { getSession } from './session';
import { signSessionToken } from './jwt';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe('getSession', () => {
  it('returns the userId when the JWT is valid and sessionVersion matches the DB', async () => {
    const token = await signSessionToken({ userId: 'user-1', sessionVersion: 2 });
    const { cookies } = await import('next/headers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cookies as any).mockResolvedValue({ get: () => ({ value: token }) });
    const { prisma } = await import('@/lib/prisma');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user.findUnique as any).mockResolvedValue({ sessionVersion: 2 });

    const session = await getSession();
    expect(session).toEqual({ userId: 'user-1' });
  });

  it('returns null when sessionVersion has been bumped (revoked session)', async () => {
    const token = await signSessionToken({ userId: 'user-1', sessionVersion: 1 });
    const { cookies } = await import('next/headers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cookies as any).mockResolvedValue({ get: () => ({ value: token }) });
    const { prisma } = await import('@/lib/prisma');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user.findUnique as any).mockResolvedValue({ sessionVersion: 2 });

    const session = await getSession();
    expect(session).toBeNull();
  });

  it('returns null when there is no cookie', async () => {
    const { cookies } = await import('next/headers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cookies as any).mockResolvedValue({ get: () => undefined });

    const session = await getSession();
    expect(session).toBeNull();
  });
});
