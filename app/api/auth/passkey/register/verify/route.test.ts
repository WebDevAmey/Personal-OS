// @vitest-environment node
// POST /api/auth/passkey/register/verify against the real test database.
// The WebAuthn signature check is mocked; challenge handling is real.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createSessionCookie, getSession } from '@/lib/auth/session';
import { apiRequest, authEventNames, createUser } from '@/lib/auth/test-helpers';

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: vi.fn(),
}));
const webauthn = await import('@simplewebauthn/server');
const verifyRegistration = vi.mocked(webauthn.verifyRegistrationResponse);
const { POST } = await import('./route');

async function signedInWithChallenge(challenge = `ch-${randomUUID()}`) {
  const user = await createUser();
  await prisma.webAuthnChallenge.create({ data: { userId: user.id, challenge, expiresAt: new Date(Date.now() + 300_000) } });
  return { user, challenge, cookie: (await createSessionCookie(user)).split(';')[0] };
}

function verified(credentialId: string, transports: unknown = ['internal']) {
  verifyRegistration.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: credentialId, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports },
      credentialBackedUp: true,
      credentialDeviceType: 'singleDevice',
    },
  } as unknown as Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>);
}

const call = (body: unknown, cookie?: string, opts: { origin?: string } = {}) =>
  POST(apiRequest('/api/auth/passkey/register/verify', body, { cookie, ...opts }));

beforeEach(() => {
  verifyRegistration.mockReset();
});

describe('POST /api/auth/passkey/register/verify', () => {
  it('stores the credential, consumes the challenge, keeps every session and records PASSKEY_ADDED', async () => {
    const { user, challenge, cookie } = await signedInWithChallenge();
    const credId = `cred-${randomUUID()}`;
    verified(credId);

    const res = await call({ response: {}, name: 'My laptop' }, cookie);
    expect(res.status).toBe(200);
    expect(verifyRegistration).toHaveBeenCalledWith(expect.objectContaining({ expectedChallenge: challenge, requireUserVerification: true }));

    const cred = await prisma.passkeyCredential.findUniqueOrThrow({ where: { id: credId } });
    expect(cred).toMatchObject({ userId: user.id, name: 'My laptop', transports: ['internal'] });
    expect(await prisma.webAuthnChallenge.count({ where: { userId: user.id } })).toBe(0);

    // SEC-R-005: adding a passkey must not sign the owner out everywhere
    // (that only helps an attacker who added one with a stolen session).
    const otherDevice = (await createSessionCookie(user)).split(';')[0];
    for (const c of [cookie, otherDevice]) {
      expect(await getSession(new Request('http://localhost:3000/', { headers: { cookie: c } }))).toEqual({ userId: user.id });
    }
    expect(res.headers.getSetCookie()).toEqual([]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(0);
    expect(await authEventNames({ userId: user.id })).toEqual(['PASSKEY_ADDED']);
  });

  it('returns 401 without a session, before calling verifyRegistrationResponse', async () => {
    const res = await call({ response: {} });
    expect(res.status).toBe(401);
    expect(verifyRegistration).not.toHaveBeenCalled();
  });

  it('never consumes another user’s challenge', async () => {
    const other = await signedInWithChallenge();
    const user = await createUser();
    const cookie = (await createSessionCookie(user)).split(';')[0];
    const res = await call({ response: {} }, cookie);
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnChallenge.count({ where: { userId: other.user.id } })).toBe(1);
  });

  it('returns 400 and stores nothing when there is no unexpired challenge', async () => {
    const user = await createUser();
    await prisma.webAuthnChallenge.create({ data: { userId: user.id, challenge: 'old', expiresAt: new Date(Date.now() - 1000) } });
    const cookie = (await createSessionCookie(user)).split(';')[0];
    expect((await call({ response: {} }, cookie)).status).toBe(400);
    expect(verifyRegistration).not.toHaveBeenCalled();
  });

  it('returns 400, stores nothing, and burns the challenge when verification fails (single use)', async () => {
    const { user, cookie } = await signedInWithChallenge();
    verifyRegistration.mockResolvedValue({ verified: false } as Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>);
    expect((await call({ response: {} }, cookie)).status).toBe(400);
    expect(await prisma.passkeyCredential.count({ where: { userId: user.id } })).toBe(0);
    verified(`cred-${randomUUID()}`);
    expect((await call({ response: {} }, cookie)).status).toBe(400);
  });

  it('returns 400 instead of crashing when verifyRegistrationResponse throws', async () => {
    const { cookie } = await signedInWithChallenge();
    verifyRegistration.mockRejectedValue(new Error('Missing credential ID'));
    expect((await call({ response: {} }, cookie)).status).toBe(400);
  });

  it('returns 400 on a malformed body', async () => {
    const { cookie } = await signedInWithChallenge();
    expect((await call('{bad', cookie)).status).toBe(400);
    expect((await call({ name: 'x' }, cookie)).status).toBe(400);
  });

  it('rejects a cross-site request', async () => {
    const { cookie } = await signedInWithChallenge();
    expect((await call({ response: {} }, cookie, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('stores an empty transports array when credential.transports is malformed', async () => {
    const { cookie } = await signedInWithChallenge();
    const credId = `cred-${randomUUID()}`;
    verified(credId, 'not-an-array');
    expect((await call({ response: {} }, cookie)).status).toBe(200);
    expect((await prisma.passkeyCredential.findUniqueOrThrow({ where: { id: credId } })).transports).toEqual([]);
  });

  it('filters out non-string entries from a partially malformed transports array', async () => {
    const { cookie } = await signedInWithChallenge();
    const credId = `cred-${randomUUID()}`;
    verified(credId, ['internal', 42, null]);
    expect((await call({ response: {} }, cookie)).status).toBe(200);
    expect((await prisma.passkeyCredential.findUniqueOrThrow({ where: { id: credId } })).transports).toEqual(['internal']);
  });
});
