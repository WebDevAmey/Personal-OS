// @vitest-environment node
//
// signSessionToken (via GET) uses jose, whose WebCrypto key-type checks do
// `instanceof Uint8Array`. jsdom (this project's default vitest environment)
// ships its own Uint8Array global that isn't reference-equal to Node's, so
// under jsdom that check fails with "Received an instance of Uint8Array"
// even though it is one. Same root cause documented in lib/auth/jwt.test.ts
// and app/api/auth/google/callback/route.test.ts — forcing the Node
// environment for this file avoids it without touching the global jsdom
// config other tests rely on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/auth/github-oauth', () => ({
  exchangeGithubCode: vi.fn(),
  fetchGithubUser: vi.fn(),
  fetchGithubUserEmails: vi.fn(),
  selectVerifiedEmail: vi.fn(),
}));

type MockedGithubOAuth = {
  exchangeGithubCode: ReturnType<typeof vi.fn>;
  fetchGithubUser: ReturnType<typeof vi.fn>;
  fetchGithubUserEmails: ReturnType<typeof vi.fn>;
  selectVerifiedEmail: ReturnType<typeof vi.fn>;
};
type MockedPrisma = {
  user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

function requestWithStateCookie(state: string, cookieState: string | null) {
  const headers = new Headers();
  if (cookieState !== null) headers.set('cookie', `github_oauth_state=${cookieState}`);
  return new Request(`http://localhost/api/auth/github/callback?code=abc&state=${state}`, { headers });
}

describe('GET /api/auth/github/callback', () => {
  // Without clearing between tests, mock.calls accumulate across the whole
  // describe block and an earlier test's call makes a later
  // `not.toHaveBeenCalled()` assertion fail spuriously — same rationale as
  // app/api/auth/google/callback/route.test.ts.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new user by githubId using the verified email, and sets a session cookie', async () => {
    const githubOAuth = (await import('@/lib/auth/github-oauth')) as unknown as MockedGithubOAuth;
    githubOAuth.exchangeGithubCode.mockResolvedValue('gh-token');
    githubOAuth.fetchGithubUser.mockResolvedValue({ id: 999, email: null, name: 'A B', avatar_url: 'https://x/y.png' });
    githubOAuth.fetchGithubUserEmails.mockResolvedValue([{ email: 'a@b.com', primary: true, verified: true }]);
    githubOAuth.selectVerifiedEmail.mockReturnValue('a@b.com');

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(307);
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { githubId: '999' } });
    expect(mockedPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ githubId: '999', email: 'a@b.com' }),
    }));
  });

  it('links to an existing user with the same verified email instead of creating a duplicate, when not found by githubId', async () => {
    const githubOAuth = (await import('@/lib/auth/github-oauth')) as unknown as MockedGithubOAuth;
    githubOAuth.exchangeGithubCode.mockResolvedValue('gh-token');
    githubOAuth.fetchGithubUser.mockResolvedValue({ id: 999, email: null, name: 'A B' });
    githubOAuth.fetchGithubUserEmails.mockResolvedValue([{ email: 'a@b.com', primary: true, verified: true }]);
    githubOAuth.selectVerifiedEmail.mockReturnValue('a@b.com');

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockImplementation(({ where }: { where: { githubId?: string; email?: string } }) => {
      if (where.githubId) return Promise.resolve(null);
      if (where.email) return Promise.resolve({ id: 'existing-user', githubId: null, sessionVersion: 0 });
      return Promise.resolve(null);
    });

    await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(mockedPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing-user' },
      data: expect.objectContaining({ githubId: '999' }),
    }));
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  // Lesson 2: a user's GitHub-associated email can change after their first
  // sign-in here. Looking up by githubId first (before falling back to
  // email) means that person is still recognized as the same account
  // instead of hitting the CREATE branch and colliding with their own row's
  // unique githubId constraint.
  it('finds an existing user by githubId even when their verified email has changed, and never goes through the create path', async () => {
    const githubOAuth = (await import('@/lib/auth/github-oauth')) as unknown as MockedGithubOAuth;
    githubOAuth.exchangeGithubCode.mockResolvedValue('gh-token');
    githubOAuth.fetchGithubUser.mockResolvedValue({ id: 999, email: null });
    githubOAuth.fetchGithubUserEmails.mockResolvedValue([{ email: 'new@x.com', primary: true, verified: true }]);
    githubOAuth.selectVerifiedEmail.mockReturnValue('new@x.com');

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', githubId: '999', email: 'old@x.com', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(307);
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { githubId: '999' } });
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalledWith({ where: { email: 'new@x.com' } });
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it('returns a clean 409 instead of an unhandled error when create hits a unique-constraint collision', async () => {
    const githubOAuth = (await import('@/lib/auth/github-oauth')) as unknown as MockedGithubOAuth;
    githubOAuth.exchangeGithubCode.mockResolvedValue('gh-token');
    githubOAuth.fetchGithubUser.mockResolvedValue({ id: 999, email: null });
    githubOAuth.fetchGithubUserEmails.mockResolvedValue([{ email: 'a@b.com', primary: true, verified: true }]);
    githubOAuth.selectVerifiedEmail.mockReturnValue('a@b.com');

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(409);
  });

  // Lesson 1 (the Critical-severity lesson from Task 7's review, applied
  // proactively here): GitHub's /user/emails can return no verified email
  // at all (e.g. a brand-new account that hasn't confirmed its address).
  // Proceeding with a null/unverified email would either crash on the
  // Prisma call or, worse, let an attacker link an unverified address into
  // a victim's existing account. This must be rejected before any
  // prisma.user call.
  it('rejects sign-in when GitHub has no verified email at all, and never touches prisma.user', async () => {
    const githubOAuth = (await import('@/lib/auth/github-oauth')) as unknown as MockedGithubOAuth;
    githubOAuth.exchangeGithubCode.mockResolvedValue('gh-token');
    githubOAuth.fetchGithubUser.mockResolvedValue({ id: 999, email: null });
    githubOAuth.fetchGithubUserEmails.mockResolvedValue([{ email: 'unverified@b.com', primary: true, verified: false }]);
    githubOAuth.selectVerifiedEmail.mockReturnValue(null);

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    expect(res.status).toBe(400);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  // Lesson 3: the state cookie has served its purpose once CSRF
  // verification passes, so it must be cleared here rather than staying
  // valid (and reusable) for the rest of its 5-minute Max-Age. Verifies two
  // distinct Set-Cookie headers are actually produced (via Headers.append),
  // not one merged/overwritten header.
  it('clears the github_oauth_state cookie alongside setting the session cookie on success', async () => {
    const githubOAuth = (await import('@/lib/auth/github-oauth')) as unknown as MockedGithubOAuth;
    githubOAuth.exchangeGithubCode.mockResolvedValue('gh-token');
    githubOAuth.fetchGithubUser.mockResolvedValue({ id: 999, email: null });
    githubOAuth.fetchGithubUserEmails.mockResolvedValue([{ email: 'a@b.com', primary: true, verified: true }]);
    githubOAuth.selectVerifiedEmail.mockReturnValue('a@b.com');

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => /^session=/.test(c))).toBe(true);
    expect(setCookies.some((c) => /^github_oauth_state=;.*Max-Age=0/.test(c))).toBe(true);
  });

  it('marks the session cookie Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const githubOAuth = (await import('@/lib/auth/github-oauth')) as unknown as MockedGithubOAuth;
    githubOAuth.exchangeGithubCode.mockResolvedValue('gh-token');
    githubOAuth.fetchGithubUser.mockResolvedValue({ id: 999, email: null });
    githubOAuth.fetchGithubUserEmails.mockResolvedValue([{ email: 'a@b.com', primary: true, verified: true }]);
    githubOAuth.selectVerifiedEmail.mockReturnValue('a@b.com');

    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: 'user-1', sessionVersion: 0 });

    const res = await GET(requestWithStateCookie('xyz', 'xyz'));
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => /^session=.*; Secure/.test(c))).toBe(true);
    vi.unstubAllEnvs();
  });

  it('rejects when the callback state does not match the state cookie (CSRF)', async () => {
    const res = await GET(requestWithStateCookie('attacker-state', 'original-state'));
    expect(res.status).toBe(400);
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when there is no state cookie at all', async () => {
    const res = await GET(requestWithStateCookie('xyz', null));
    expect(res.status).toBe(400);
  });

  it('rejects when there is no code param', async () => {
    const req = new Request('http://localhost/api/auth/github/callback?state=xyz', {
      headers: { cookie: 'github_oauth_state=xyz' },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
