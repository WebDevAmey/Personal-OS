// @vitest-environment node
// POST /api/auth/passkey/register/options against the real test database.
import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { userIdToUserHandle } from '@/lib/auth/webauthn';
import { createSessionCookie } from '@/lib/auth/session';
import { apiRequest, authEventNames, createUser } from '@/lib/auth/test-helpers';

import { POST } from './route';

async function signedIn() {
  const user = await createUser();
  return { user, cookie: (await createSessionCookie(user)).split(';')[0] };
}

const call = (cookie?: string, opts: { origin?: string; body?: unknown } = {}) =>
  POST(apiRequest('/api/auth/passkey/register/options', opts.body, { cookie, origin: opts.origin }));

/** A session whose token was issued `minutesAgo` minutes ago (JWT iat). */
async function signedInMinutesAgo(minutesAgo: number, password?: string | null) {
  const user = await createUser(password === undefined ? {} : { password });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() - minutesAgo * 60_000);
  try {
    return { user, cookie: (await createSessionCookie(user)).split(';')[0] };
  } finally {
    vi.useRealTimers();
  }
}

describe('POST /api/auth/passkey/register/options', () => {
  it('returns registration options and persists a 5-minute challenge scoped to the signed-in user', async () => {
    const { user, cookie } = await signedIn();
    const before = Date.now();
    const res = await call(cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const rows = await prisma.webAuthnChallenge.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].challenge).toBe(body.challenge);
    const ttl = rows[0].expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000 + 1000);
  });

  it('returns 401 without a session, before writing anything', async () => {
    const before = await prisma.webAuthnChallenge.count();
    const res = await call();
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnChallenge.count()).toBeLessThanOrEqual(before);
  });

  it('rejects a cross-site request', async () => {
    const { cookie } = await signedIn();
    expect((await call(cookie, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it("populates excludeCredentials from the user's existing passkeys", async () => {
    const { user, cookie } = await signedIn();
    const credId = `cred-${randomUUID()}`;
    await prisma.passkeyCredential.create({
      data: { id: credId, userId: user.id, publicKey: Buffer.from([1]), transports: ['internal'], deviceType: 'singleDevice' },
    });
    const body = await (await call(cookie)).json();
    expect(body.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([credId]);
  });

  it('requests a resident, user-verified credential', async () => {
    const { cookie } = await signedIn();
    const body = await (await call(cookie)).json();
    expect(body.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
  });

  it('derives the same user handle for the same user across calls', async () => {
    const { user, cookie } = await signedIn();
    const a = (await (await call(cookie)).json()).user.id;
    const b = (await (await call(cookie)).json()).user.id;
    expect(a).toBe(Buffer.from(userIdToUserHandle(user.id)).toString('base64url'));
    expect(b).toBe(a);
  });

  it("keeps only the newest registration challenge for the user", async () => {
    const { user, cookie } = await signedIn();
    await call(cookie);
    const second = await (await call(cookie)).json();
    const rows = await prisma.webAuthnChallenge.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => r.challenge)).toEqual([second.challenge]);
  });

  describe('recent authentication (SEC-R-005)', () => {
    it('accepts a session issued within the last 15 minutes', async () => {
      const { cookie } = await signedInMinutesAgo(14);
      expect((await call(cookie)).status).toBe(200);
    });

    it('rejects an older session with REAUTH_REQUIRED and issues no challenge', async () => {
      const { user, cookie } = await signedInMinutesAgo(16);
      const res = await call(cookie);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'REAUTH_REQUIRED' });
      expect(await prisma.webAuthnChallenge.count({ where: { userId: user.id } })).toBe(0);
    });

    it('accepts an older session when the correct password is re-entered', async () => {
      const { user, cookie } = await signedInMinutesAgo(60);
      const res = await call(cookie, { body: { password: 'correct horse battery staple' } });
      expect(res.status).toBe(200);
      expect(await prisma.webAuthnChallenge.count({ where: { userId: user.id } })).toBe(1);
    });

    it('rejects a wrong password, counts it toward the lockout and issues no challenge', async () => {
      const { user, cookie } = await signedInMinutesAgo(60);
      const res = await call(cookie, { body: { password: 'wrong password guess' } });
      expect(res.status).toBe(401);
      expect(await prisma.webAuthnChallenge.count({ where: { userId: user.id } })).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginAttempts).toBe(1);
      expect(await authEventNames({ userId: user.id })).toContain('LOGIN_FAILURE');
    });

    it('requires a fresh sign-in for an account without a password', async () => {
      const { cookie } = await signedInMinutesAgo(60, null);
      const res = await call(cookie, { body: { password: 'anything at all' } });
      expect(res.status).toBe(401);
    });

    it('rejects unknown body fields', async () => {
      const { cookie } = await signedIn();
      expect((await call(cookie, { body: { userId: 'someone-else' } })).status).toBe(400);
    });
  });
});
