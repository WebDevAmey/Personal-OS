// @vitest-environment node
// SEC-B-003 regression: passkey sign-in challenge binding, single use and
// user-handle checks, against the real test database. The signature check
// is replaced by a fake that "verifies" only when the assertion was made for
// the expected challenge (the test puts that challenge in clientDataJSON).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth/jwt';
import { apiRequest, authEventNames, createUser, uniqueIp } from '@/lib/auth/test-helpers';

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyAuthenticationResponse: vi.fn(),
}));
const webauthn = await import('@simplewebauthn/server');
const verifyAuth = vi.mocked(webauthn.verifyAuthenticationResponse);
const { POST: options } = await import('../options/route');
const { POST: verify } = await import('./route');

type VerifyArgs = Parameters<typeof webauthn.verifyAuthenticationResponse>[0];

function fakeVerifier(newCounter = 7) {
  verifyAuth.mockImplementation(async (args: VerifyArgs) => {
    const madeFor = (args.response.response as { clientDataJSON: string }).clientDataJSON;
    const ok = madeFor === args.expectedChallenge;
    return { verified: ok, authenticationInfo: ok ? { newCounter } : undefined } as Awaited<ReturnType<typeof webauthn.verifyAuthenticationResponse>>;
  });
}

async function userWithPasskey() {
  const user = await createUser();
  const credentialId = `cred-${randomUUID()}`;
  await prisma.passkeyCredential.create({
    data: { id: credentialId, userId: user.id, publicKey: Buffer.from([1, 2, 3]), transports: ['internal'], deviceType: 'multiDevice' },
  });
  return { user, credentialId };
}

/** Starts a ceremony in one "browser": returns its challenge and cookie. */
async function startCeremony() {
  const res = await options(apiRequest('/api/auth/passkey/auth/options', undefined, { ip: uniqueIp() }));
  const { challenge } = await res.json();
  return { challenge, cookie: res.headers.getSetCookie()[0].split(';')[0] };
}

function assertion(credentialId: string, userId: string | null, signedChallenge: string, overrides: Record<string, unknown> = {}) {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: signedChallenge,
      authenticatorData: 'AAAA',
      signature: 'BBBB',
      ...(userId ? { userHandle: Buffer.from(userId).toString('base64url') } : {}),
    },
    ...overrides,
  };
}

const submit = (body: unknown, cookie?: string) => verify(apiRequest('/api/auth/passkey/auth/verify', body, { cookie }));

beforeEach(() => {
  verifyAuth.mockReset();
  fakeVerifier();
});

describe('POST /api/auth/passkey/auth/verify (SEC-B-003)', () => {
  it('signs in with JSON (not a redirect), updates the counter and consumes the challenge', async () => {
    const { user, credentialId } = await userWithPasskey();
    const { challenge, cookie } = await startCeremony();
    const res = await submit({ response: assertion(credentialId, user.id, challenge), credentialId }, cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Signed in', redirectTo: '/today' });
    expect(verifyAuth).toHaveBeenCalledWith(expect.objectContaining({ expectedChallenge: challenge, requireUserVerification: true }));
    const session = res.headers.getSetCookie().find((c) => c.startsWith('session='))!;
    expect(await verifySessionToken(session.split(';')[0].slice(8))).toEqual({ userId: user.id, sessionVersion: 0 });
    expect(res.headers.getSetCookie().find((c) => c.startsWith('pk_chal='))).toMatch(/Max-Age=0/);

    const cred = await prisma.passkeyCredential.findUniqueOrThrow({ where: { id: credentialId } });
    expect(cred.counter).toBe(BigInt(7));
    expect(cred.lastUsedAt).not.toBeNull();
    const id = cookie.split('=')[1];
    expect(await prisma.webAuthnChallenge.findUnique({ where: { id } })).toBeNull();
    expect(await authEventNames({ userId: user.id })).toEqual(['PASSKEY_LOGIN_SUCCESS']);
  });

  it("rejects an assertion made for another browser's ceremony", async () => {
    const { user, credentialId } = await userWithPasskey();
    const victim = await startCeremony();
    const attacker = await startCeremony();
    // Assertion signed over the victim's challenge, replayed with the attacker's cookie.
    const res = await submit({ response: assertion(credentialId, user.id, victim.challenge) }, attacker.cookie);
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('session='))).toBe(false);
  });

  it('a newer anonymous options call does not break or replace an in-flight ceremony', async () => {
    const { user, credentialId } = await userWithPasskey();
    const mine = await startCeremony();
    for (let i = 0; i < 3; i++) await startCeremony();
    expect((await submit({ response: assertion(credentialId, user.id, mine.challenge) }, mine.cookie)).status).toBe(200);
  });

  it('rejects a second use of the same challenge (replay)', async () => {
    const { user, credentialId } = await userWithPasskey();
    const { challenge, cookie } = await startCeremony();
    const body = { response: assertion(credentialId, user.id, challenge) };
    expect((await submit(body, cookie)).status).toBe(200);
    verifyAuth.mockClear();
    expect((await submit(body, cookie)).status).toBe(400);
    expect(verifyAuth).not.toHaveBeenCalled();
  });

  it('consumes the challenge on a failed attempt too', async () => {
    const { user, credentialId } = await userWithPasskey();
    const { challenge, cookie } = await startCeremony();
    expect((await submit({ response: assertion(credentialId, user.id, 'wrong-challenge') }, cookie)).status).toBe(400);
    expect((await submit({ response: assertion(credentialId, user.id, challenge) }, cookie)).status).toBe(400);
  });

  it('concurrent submissions of one challenge: at most one succeeds', async () => {
    const { user, credentialId } = await userWithPasskey();
    const { challenge, cookie } = await startCeremony();
    const body = { response: assertion(credentialId, user.id, challenge) };
    const statuses = (await Promise.all(Array.from({ length: 5 }, () => submit(body, cookie)))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  });

  it('rejects without the challenge cookie', async () => {
    const { user, credentialId } = await userWithPasskey();
    const { challenge } = await startCeremony();
    expect((await submit({ response: assertion(credentialId, user.id, challenge) })).status).toBe(400);
    expect(verifyAuth).not.toHaveBeenCalled();
  });

  it('rejects an expired challenge', async () => {
    const { user, credentialId } = await userWithPasskey();
    const { challenge, cookie } = await startCeremony();
    await prisma.webAuthnChallenge.update({ where: { id: cookie.split('=')[1] }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await submit({ response: assertion(credentialId, user.id, challenge) }, cookie)).status).toBe(400);
  });

  it("rejects a userHandle that is not the credential owner's", async () => {
    const { credentialId } = await userWithPasskey();
    const other = await createUser();
    const { challenge, cookie } = await startCeremony();
    const res = await submit({ response: assertion(credentialId, other.id, challenge) }, cookie);
    expect(res.status).toBe(400);
    expect(verifyAuth).not.toHaveBeenCalled();
  });

  it('rejects a missing userHandle', async () => {
    const { credentialId } = await userWithPasskey();
    const { challenge, cookie } = await startCeremony();
    expect((await submit({ response: assertion(credentialId, null, challenge) }, cookie)).status).toBe(400);
  });

  it('rejects when response.id differs from credentialId or rawId', async () => {
    const { user, credentialId } = await userWithPasskey();
    const a = await startCeremony();
    expect((await submit({ response: assertion(credentialId, user.id, a.challenge), credentialId: 'other' }, a.cookie)).status).toBe(400);
    const b = await startCeremony();
    expect((await submit({ response: assertion(credentialId, user.id, b.challenge, { rawId: 'other' }) }, b.cookie)).status).toBe(400);
  });

  it('rejects an unknown credential and returns 400 when verification throws (e.g. counter regression)', async () => {
    const { user, credentialId } = await userWithPasskey();
    const a = await startCeremony();
    expect((await submit({ response: assertion('cred-unknown', user.id, a.challenge) }, a.cookie)).status).toBe(400);
    const b = await startCeremony();
    verifyAuth.mockRejectedValue(new Error('Response counter value 1 was lower than expected 7'));
    expect((await submit({ response: assertion(credentialId, user.id, b.challenge) }, b.cookie)).status).toBe(400);
    expect(await authEventNames({ userId: user.id })).toContain('PASSKEY_LOGIN_FAILURE');
  });

  it('rejects a malformed body but still burns the challenge', async () => {
    const { user, credentialId } = await userWithPasskey();
    const { challenge, cookie } = await startCeremony();
    expect((await submit('{bad', cookie)).status).toBe(400);
    expect((await submit({ response: assertion(credentialId, user.id, challenge) }, cookie)).status).toBe(400);
  });
});
