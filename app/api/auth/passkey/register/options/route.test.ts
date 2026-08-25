// app/api/auth/passkey/register/options/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { userIdToUserHandle } from '@/lib/auth/webauthn';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    webAuthnChallenge: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
}));

type MockedSession = { getSession: ReturnType<typeof vi.fn> };
type MockedPrisma = {
  user: { findUnique: ReturnType<typeof vi.fn> };
  webAuthnChallenge: { create: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
};
type MockedWebAuthn = { generateRegistrationOptions: ReturnType<typeof vi.fn> };

describe('POST /api/auth/passkey/register/options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns registration options and persists a challenge scoped to the signed-in user', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', passkeyCredentials: [] });

    const { generateRegistrationOptions } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    generateRegistrationOptions.mockResolvedValue({ challenge: 'new-challenge', rp: {}, user: {} });

    const before = Date.now();
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ challenge: 'new-challenge', rp: {}, user: {} });
    expect(prisma.webAuthnChallenge.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.webAuthnChallenge.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('user-1');
    expect(createArgs.data.challenge).toBe('new-challenge');
    // Roughly 5 minutes out -- exact TTL enforced in the verify route via expiresAt.
    const ttlMs = createArgs.data.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(4 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });

  it('returns 401 when there is no session, before calling prisma or the WebAuthn library', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue(null);

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    const { generateRegistrationOptions } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;

    const res = await POST();

    expect(res.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
    expect(prisma.webAuthnChallenge.deleteMany).not.toHaveBeenCalled();
    expect(prisma.webAuthnChallenge.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the session user no longer exists', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await POST();
    expect(res.status).toBe(404);
  });

  // Security: without this, a user could register the same physical
  // authenticator (or platform passkey) more than once for their account.
  it('populates excludeCredentials from the user\'s existing passkeys', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      passkeyCredentials: [
        { id: 'existing-cred-1', transports: ['internal'] },
        { id: 'existing-cred-2', transports: ['usb', 'nfc'] },
      ],
    });

    const { generateRegistrationOptions } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    generateRegistrationOptions.mockResolvedValue({ challenge: 'new-challenge', rp: {}, user: {} });

    await POST();

    expect(generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      excludeCredentials: [
        { id: 'existing-cred-1', transports: ['internal'] },
        { id: 'existing-cred-2', transports: ['usb', 'nfc'] },
      ],
    }));
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      include: { passkeyCredentials: true },
    }));
  });

  // Required for the credential to be discoverable/usernameless-login-ready,
  // and to match verifyRegistrationResponse's default of
  // requireUserVerification: true -- see verify/route.ts.
  it('requests a resident, user-verified credential via authenticatorSelection', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', passkeyCredentials: [] });

    const { generateRegistrationOptions } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    generateRegistrationOptions.mockResolvedValue({ challenge: 'new-challenge', rp: {}, user: {} });

    await POST();

    expect(generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    }));
  });

  // Usernameless/discoverable login (a future task) looks a credential up by
  // its embedded WebAuthn user handle -- that only works if the SAME user
  // gets the SAME handle every time, rather than a fresh random value per call.
  it('derives the same userID bytes for the same session.userId across two separate calls', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', passkeyCredentials: [] });

    const { generateRegistrationOptions } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    generateRegistrationOptions.mockResolvedValue({ challenge: 'new-challenge', rp: {}, user: {} });

    await POST();
    await POST();

    expect(generateRegistrationOptions).toHaveBeenCalledTimes(2);
    const firstUserID = generateRegistrationOptions.mock.calls[0][0].userID;
    const secondUserID = generateRegistrationOptions.mock.calls[1][0].userID;
    expect(firstUserID).toEqual(userIdToUserHandle('user-1'));
    expect(secondUserID).toEqual(userIdToUserHandle('user-1'));
    expect(firstUserID).toEqual(secondUserID);
  });

  // Concurrency: without clearing prior challenge rows first, two concurrent
  // registration attempts (e.g. two open tabs) can race against each other --
  // whichever ceremony completes gets checked against whatever row is
  // currently "newest" for the user, which may belong to the OTHER attempt.
  it('clears the user\'s prior challenge rows before creating the new one', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', passkeyCredentials: [] });

    const { generateRegistrationOptions } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    generateRegistrationOptions.mockResolvedValue({ challenge: 'first-challenge', rp: {}, user: {} });
    await POST();

    generateRegistrationOptions.mockResolvedValue({ challenge: 'second-challenge', rp: {}, user: {} });
    await POST();

    expect(prisma.webAuthnChallenge.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.webAuthnChallenge.deleteMany).toHaveBeenNthCalledWith(2, { where: { userId: 'user-1' } });

    // deleteMany must run before create on the second call, otherwise the
    // fresh row it just created would immediately be wiped out too.
    const deleteOrder = prisma.webAuthnChallenge.deleteMany.mock.invocationCallOrder[1];
    const createOrder = prisma.webAuthnChallenge.create.mock.invocationCallOrder[1];
    expect(deleteOrder).toBeLessThan(createOrder);
  });
});
