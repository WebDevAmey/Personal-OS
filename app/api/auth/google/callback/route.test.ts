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
import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }, integrationAccount: { upsert: vi.fn() } },
}));
vi.mock('@/lib/auth/google-oauth', () => ({
  exchangeGoogleCode: vi.fn(),
  decodeGoogleIdToken: vi.fn(),
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
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com', name: 'A B' });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(307); // redirect to /today
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
    expect(mockedPrisma.integrationAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_provider: { userId: 'user-1', provider: 'google' } },
      create: expect.objectContaining({ accessToken: 'access-xyz', refreshToken: 'refresh-xyz' }),
    }));
  });

  it('links to an existing user with the same email instead of creating a duplicate', async () => {
    const googleOAuth = (await import('@/lib/auth/google-oauth')) as unknown as MockedGoogleOAuth;
    googleOAuth.exchangeGoogleCode.mockResolvedValue({ access_token: 'access-xyz', expires_in: 3600, id_token: 'idtok' });
    googleOAuth.decodeGoogleIdToken.mockReturnValue({ sub: 'google-sub-1', email: 'a@b.com' });

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user', googleId: null, sessionVersion: 0 });

    await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(mockedPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing-user' },
      data: expect.objectContaining({ googleId: 'google-sub-1' }),
    }));
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
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
