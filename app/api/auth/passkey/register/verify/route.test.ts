// app/api/auth/passkey/register/verify/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { webAuthnChallenge: { findFirst: vi.fn(), delete: vi.fn() }, passkeyCredential: { create: vi.fn() } },
}));
vi.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: vi.fn(),
}));

type MockedSession = { getSession: ReturnType<typeof vi.fn> };
type MockedPrisma = {
  webAuthnChallenge: { findFirst: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  passkeyCredential: { create: ReturnType<typeof vi.fn> };
};
type MockedWebAuthn = { verifyRegistrationResponse: ReturnType<typeof vi.fn> };

function req(body: unknown) {
  return new Request('http://localhost/api/auth/passkey/register/verify', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/auth/passkey/register/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a new passkey credential on successful verification', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });

    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
        credentialBackedUp: true,
        credentialDeviceType: 'singleDevice',
      },
    });

    const res = await POST(req({ response: {}, name: 'My laptop' }));

    expect(res.status).toBe(200);
    expect(prisma.passkeyCredential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', id: 'cred-1', name: 'My laptop' }),
    }));
  });

  it('returns 401 when there is no session', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue(null);

    const res = await POST(req({}));
    expect(res.status).toBe(401);
  });

  // Security: an unauthenticated caller must be rejected before the route
  // touches the database or the WebAuthn library at all -- otherwise it
  // could be used to probe/consume challenge rows or trigger crypto work
  // without a valid session.
  it('rejects an unauthenticated request before calling prisma or verifyRegistrationResponse', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue(null);

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;

    await POST(req({ response: {}, name: 'My laptop' }));

    expect(prisma.webAuthnChallenge.findFirst).not.toHaveBeenCalled();
    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
    expect(prisma.passkeyCredential.create).not.toHaveBeenCalled();
  });

  // Security: the challenge lookup must be scoped to the signed-in user's
  // id, never "the newest challenge for anyone" -- otherwise user A could
  // complete a WebAuthn ceremony using a challenge issued for user B.
  it('scopes the challenge lookup to the signed-in user, not any unexpired challenge', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });

    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
        credentialBackedUp: true,
        credentialDeviceType: 'singleDevice',
      },
    });

    await POST(req({ response: {}, name: 'My laptop' }));

    expect(prisma.webAuthnChallenge.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1' }),
    }));
  });

  // Security: single-use. Once a challenge has been consumed by a
  // successful verification it must be deleted immediately, so it can
  // never be replayed to register a second credential.
  it('deletes the challenge after a successful verification', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });

    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
        credentialBackedUp: true,
        credentialDeviceType: 'singleDevice',
      },
    });

    await POST(req({ response: {}, name: 'My laptop' }));

    expect(prisma.webAuthnChallenge.delete).toHaveBeenCalledWith({ where: { id: 'ch-1' } });
  });

  it('returns 400 and stores nothing when there is no unexpired challenge for this user', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.webAuthnChallenge.findFirst.mockResolvedValue(null);

    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;

    const res = await POST(req({ response: {}, name: 'My laptop' }));

    expect(res.status).toBe(400);
    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
    expect(prisma.passkeyCredential.create).not.toHaveBeenCalled();
  });

  it('returns 400 and does not store or delete anything when verification.verified is false', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });

    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    verifyRegistrationResponse.mockResolvedValue({ verified: false });

    const res = await POST(req({ response: {}, name: 'My laptop' }));

    expect(res.status).toBe(400);
    expect(prisma.passkeyCredential.create).not.toHaveBeenCalled();
    expect(prisma.webAuthnChallenge.delete).not.toHaveBeenCalled();
  });

  // The underlying library throws on a malformed/incompatible response
  // object (e.g. a tampered or garbage payload) rather than resolving
  // { verified: false }. That must not surface as an unhandled 500.
  it('returns 400 instead of crashing when verifyRegistrationResponse throws', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });

    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    verifyRegistrationResponse.mockRejectedValue(new Error('Missing credential ID'));

    const res = await POST(req({ response: {}, name: 'My laptop' }));

    expect(res.status).toBe(400);
    expect(prisma.passkeyCredential.create).not.toHaveBeenCalled();
    expect(prisma.webAuthnChallenge.delete).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON body', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const res = await POST(req('not json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the body is missing the response field', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const res = await POST(req({ name: 'My laptop' }));
    expect(res.status).toBe(400);
  });

  // credential.transports is transport hints, NOT part of the signed payload
  // verifyRegistrationResponse validates -- a malformed value here must
  // degrade to an empty array instead of reaching Prisma's String[] column
  // and throwing an unhandled PrismaClientValidationError.
  it('stores an empty transports array when credential.transports is malformed', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });

    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: 'not-an-array',
        },
        credentialBackedUp: true,
        credentialDeviceType: 'singleDevice',
      },
    });

    const res = await POST(req({ response: {}, name: 'My laptop' }));

    expect(res.status).toBe(200);
    expect(prisma.passkeyCredential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transports: [] }),
    }));
  });

  it('filters out non-string entries from a partially malformed transports array', async () => {
    const { getSession } = (await import('@/lib/auth/session')) as unknown as MockedSession;
    getSession.mockResolvedValue({ userId: 'user-1' });

    const { prisma } = (await import('@/lib/prisma')) as unknown as { prisma: MockedPrisma };
    prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: 'ch-1', challenge: 'challenge-str' });

    const { verifyRegistrationResponse } = (await import('@simplewebauthn/server')) as unknown as MockedWebAuthn;
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal', 42, null],
        },
        credentialBackedUp: true,
        credentialDeviceType: 'singleDevice',
      },
    });

    const res = await POST(req({ response: {}, name: 'My laptop' }));

    expect(res.status).toBe(200);
    expect(prisma.passkeyCredential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transports: ['internal'] }),
    }));
  });
});
