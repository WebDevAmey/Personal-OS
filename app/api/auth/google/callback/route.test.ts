// @vitest-environment node
// GET /api/auth/google/callback against the real test database. Google's
// token endpoint and ID-token verification are mocked (no network).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { decryptToken, isEncryptedToken } from '@/lib/security/token-crypto';
import { verifySessionToken } from '@/lib/auth/jwt';
import { authEventNames, createUser, uniqueEmail } from '@/lib/auth/test-helpers';

vi.mock('@/lib/auth/google-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/google-oauth')>()),
  exchangeGoogleCode: vi.fn(),
  verifyGoogleIdToken: vi.fn(),
}));

const googleOAuth = await import('@/lib/auth/google-oauth');
const exchange = vi.mocked(googleOAuth.exchangeGoogleCode);
const verifyIdToken = vi.mocked(googleOAuth.verifyGoogleIdToken);
const { GET } = await import('./route');

function callback(opts: { state?: string; cookieState?: string | null; verifier?: string | null; code?: string | null } = {}) {
  const state = opts.state ?? 'state-1';
  const cookies: string[] = [];
  const cookieState = opts.cookieState === undefined ? state : opts.cookieState;
  if (cookieState !== null) cookies.push(`google_oauth_state=${cookieState}`);
  const verifier = opts.verifier === undefined ? 'verifier-1' : opts.verifier;
  if (verifier !== null) cookies.push(`google_oauth_pkce=${verifier}`);
  const code = opts.code === undefined ? 'code-1' : opts.code;
  const qs = new URLSearchParams({ state, ...(code ? { code } : {}) });
  return GET(new Request(`http://localhost:3000/api/auth/google/callback?${qs}`, { headers: { cookie: cookies.join('; ') } }));
}

function googleReturns(claims: { sub?: string; email: string; email_verified?: boolean }, tokens: Record<string, unknown> = {}) {
  exchange.mockResolvedValue({
    access_token: 'ya29.access-token-value',
    refresh_token: '1//refresh-token-value',
    expires_in: 3600,
    id_token: 'id-token',
    scope: 'openid email https://www.googleapis.com/auth/gmail.readonly',
    ...tokens,
  });
  verifyIdToken.mockResolvedValue({ sub: claims.sub ?? `g-${randomUUID()}`, email: claims.email, email_verified: claims.email_verified ?? true });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/auth/google/callback', () => {
  it('creates a verified user, stores ENCRYPTED tokens (SEC-B-017) and sets a session cookie', async () => {
    const email = uniqueEmail('google');
    googleReturns({ email });
    const res = await callback();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/today');

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(true);
    const account = await prisma.integrationAccount.findUniqueOrThrow({ where: { userId_provider: { userId: user.id, provider: 'google' } } });
    expect(isEncryptedToken(account.accessToken)).toBe(true);
    expect(isEncryptedToken(account.refreshToken!)).toBe(true);
    expect(account.accessToken).not.toContain('ya29');
    expect(decryptToken(account.accessToken)).toBe('ya29.access-token-value');
    expect(decryptToken(account.refreshToken!)).toBe('1//refresh-token-value');
    expect(account.scopes).toBe('openid email https://www.googleapis.com/auth/gmail.readonly');

    const session = res.headers.getSetCookie().find((c) => c.startsWith('session='))!;
    expect(await verifySessionToken(session.split(';')[0].slice(8))).toEqual({ userId: user.id, sessionVersion: 0 });
    expect(await authEventNames({ userId: user.id })).toEqual(['OAUTH_LOGIN_SUCCESS']);
  });

  it('passes the PKCE verifier from the cookie to the token exchange', async () => {
    googleReturns({ email: uniqueEmail() });
    await callback({ verifier: 'the-verifier-value' });
    expect(exchange).toHaveBeenCalledWith('code-1', 'the-verifier-value');
  });

  it('clears the state and PKCE cookies on success', async () => {
    googleReturns({ email: uniqueEmail() });
    const cookies = (await callback()).headers.getSetCookie();
    expect(cookies.find((c) => c.startsWith('google_oauth_state='))).toMatch(/Max-Age=0/);
    expect(cookies.find((c) => c.startsWith('google_oauth_pkce='))).toMatch(/Max-Age=0/);
  });

  it('keeps the stored refresh token when Google does not send a new one', async () => {
    const sub = `g-${randomUUID()}`;
    const email = uniqueEmail();
    googleReturns({ sub, email });
    await callback();
    googleReturns({ sub, email }, { refresh_token: undefined, access_token: 'ya29.second' });
    await callback();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const account = await prisma.integrationAccount.findUniqueOrThrow({ where: { userId_provider: { userId: user.id, provider: 'google' } } });
    expect(decryptToken(account.accessToken)).toBe('ya29.second');
    expect(decryptToken(account.refreshToken!)).toBe('1//refresh-token-value');
  });

  it('falls back to the requested scope string when the token response omits scope', async () => {
    const email = uniqueEmail();
    googleReturns({ email }, { scope: undefined });
    await callback();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const account = await prisma.integrationAccount.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.scopes).toBe(googleOAuth.SCOPES);
  });

  it('finds an existing user by googleId even when their Google email has changed', async () => {
    const sub = `g-${randomUUID()}`;
    const existing = await createUser({ googleId: sub });
    googleReturns({ sub, email: uniqueEmail('changed') });
    const res = await callback();
    expect(res.status).toBe(307);
    const session = res.headers.getSetCookie().find((c) => c.startsWith('session='))!;
    expect((await verifySessionToken(session.split(';')[0].slice(8)))?.userId).toBe(existing.id);
  });

  it('links to an existing verified account with the same email and revokes its older sessions', async () => {
    const existing = await createUser();
    googleReturns({ email: existing.email });
    const res = await callback();
    expect(res.status).toBe(307);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(row.googleId).not.toBeNull();
    expect(row.password).not.toBeNull();
    expect(row.sessionVersion).toBe(1);
    expect(await authEventNames({ userId: existing.id })).toEqual(['OAUTH_LINKED', 'OAUTH_LOGIN_SUCCESS']);
  });

  it('returns 409 when the email already belongs to a different Google identity', async () => {
    const existing = await createUser({ googleId: `g-${randomUUID()}` });
    googleReturns({ email: existing.email });
    expect((await callback()).status).toBe(409);
  });

  it.each([false, undefined])('rejects email_verified=%s before touching any user row', async (verified) => {
    const email = uniqueEmail();
    exchange.mockResolvedValue({ access_token: 'a', expires_in: 1, id_token: 'i' });
    verifyIdToken.mockResolvedValue({ sub: 'x', email, email_verified: verified });
    const res = await callback();
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('rejects when ID-token verification fails (bad signature, aud, iss or exp)', async () => {
    exchange.mockResolvedValue({ access_token: 'a', expires_in: 1, id_token: 'forged' });
    verifyIdToken.mockRejectedValue(new Error('signature verification failed'));
    expect((await callback()).status).toBe(400);
  });

  it('rejects when the callback state does not match the state cookie (CSRF)', async () => {
    const res = await callback({ state: 'attacker', cookieState: 'victim' });
    expect(res.status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects when there is no state cookie at all', async () => {
    expect((await callback({ cookieState: null })).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects when the PKCE verifier cookie is missing', async () => {
    expect((await callback({ verifier: null })).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects when there is no code param', async () => {
    expect((await callback({ code: null })).status).toBe(400);
  });
});
