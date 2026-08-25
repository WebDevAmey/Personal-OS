// @vitest-environment node
//
// signSessionToken (via GET) uses jose, whose WebCrypto key-type checks do
// `instanceof Uint8Array`. jsdom (this project's default vitest environment)
// ships its own Uint8Array global that isn't reference-equal to Node's, so
// under jsdom that check fails with "Received an instance of Uint8Array"
// even though it is one. Same root cause documented in lib/auth/jwt.test.ts
// and app/api/auth/login/route.test.ts — forcing the Node environment for
// this file avoids it without touching the global jsdom config other tests
// rely on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }, integrationAccount: { upsert: vi.fn() } },
}));
vi.mock('@/lib/auth/google-oauth', () => ({
  exchangeGoogleCode: vi.fn(),
  decodeGoogleIdToken: vi.fn(),
  SCOPES: 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.readonly',
}));

type MockedGoogleOAuth = {
  exchangeGoogleCode: ReturnType<typeof vi.fn>;
  decodeGoogleIdToken: ReturnType<typeof vi.fn>;
};
type MockedPrisma = {
  user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  integrationAccount: { upsert: ReturnType<typeof vi.fn> };
};

function requestWithStateCookie(state: string, cookieState: string | null) {
  const headers = new Headers();
  if (cookieState !== null) headers.set('cookie', `google_oauth_state=${cookieState}`);
  return new Request(`http://localhost/api/auth/google/callback?code=abc&state=${state}`, { headers });
}

describe('GET /api/auth/google/callback', () => {
  // Each test below asserts on mock.calls (including `not.toHaveBeenCalled()`
  // in the CSRF-rejection tests). Without clearing between tests, calls
  // accumulate across the whole describe block and an earlier test's call
  // makes a later `not.toHaveBeenCalled()` assertion fail spuriously — same
  // rationale as app/api/auth/login/route.test.ts.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new user by googleId, persists integration tokens, and sets a session cookie', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({
      access_token: 'access-xyz', refresh_token: 'refresh-xyz', expires_in: 3600, id_token: 'idtok',
    });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com', name: 'A B', email_verified: true });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(307); // redirect to /today
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
    // Both the googleId lookup and the email fallback lookup should have run
    // before falling through to create.
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { googleId: 'google-sub-1' } });
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
    expect(mockedPrisma.integrationAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_provider: { userId: 'user-1', provider: 'google' } },
      create: expect.objectContaining({ accessToken: 'access-xyz', refreshToken: 'refresh-xyz' }),
    }));
  });

  it('links to an existing user with the same email instead of creating a duplicate, when not found by googleId', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com', email_verified: true });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockImplementation(({ where }: { where: { googleId?: string; email?: string } }) => {
      if (where.googleId) return Promise.resolve(null);
      if (where.email) return Promise.resolve({ id: 'existing-user', googleId: null, sessionVersion: 0 });
      return Promise.resolve(null);
    });

    await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(mockedPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing-user' },
      data: expect.objectContaining({ googleId: 'google-sub-1' }),
    }));
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  // Finding 2: a user's Google email can change after their first sign-in
  // here. Looking up by googleId first (before falling back to email) means
  // that person is still recognized as the same account instead of hitting
  // the CREATE branch and colliding with their own row's unique googleId.
  it('finds an existing user by googleId even when their Google email has changed, and never goes through the create path', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'sub-1', email: 'new@x.com', email_verified: true });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', googleId: 'sub-1', email: 'old@x.com', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(307);
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { googleId: 'sub-1' } });
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalledWith({ where: { email: 'new@x.com' } });
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it('returns a clean 409 instead of an unhandled error when create hits a unique-constraint collision', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com', email_verified: true });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(409);
  });

  // Finding 1 (CRITICAL): Google will complete a valid OAuth flow for an
  // account whose email was never actually verified. Trusting that email
  // for lookup would let an attacker who controls such a Google account get
  // linked into the victim's existing account — full session takeover.
  it('rejects sign-in when the Google email is not verified, and never touches prisma.user', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'victim@example.com', email_verified: false });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(400);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects sign-in when the Google email_verified claim is missing entirely, and never touches prisma.user', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'victim@example.com' });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(400);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  // Finding 3: the state cookie has served its purpose once CSRF verification
  // passes, so it must be cleared here rather than staying valid (and
  // reusable) for the rest of its 5-minute Max-Age.
  it('clears the google_oauth_state cookie alongside setting the session cookie on success', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com', email_verified: true });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => /^session=/.test(c))).toBe(true);
    expect(setCookies.some((c) => /^google_oauth_state=;.*Max-Age=0/.test(c))).toBe(true);
  });

  // Finding 4: Google lets users decline individual scopes at the consent
  // screen, so the stored `scopes` value must reflect what was actually
  // granted, not a hardcoded literal of what was requested.
  it('records only the scopes Google actually granted, not a hardcoded literal', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({
      access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok',
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com', email_verified: true });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(mockedPrisma.integrationAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ scopes: 'openid email profile https://www.googleapis.com/auth/gmail.readonly' }),
    }));
  });

  it('falls back to the full requested scope string when the token response omits scope', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com', email_verified: true });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(mockedPrisma.integrationAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        scopes: 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.readonly',
      }),
    }));
  });

  it('rejects when the callback state does not match the state cookie (CSRF)', async () => {
    const res = await GET(requestWithStateCookie('attacker-supplied-state', 'original-state'));
    expect(res.status).toBe(400);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when there is no state cookie at all', async () => {
    const res = await GET(requestWithStateCookie('xyz', null));
    expect(res.status).toBe(400);
  });
});
