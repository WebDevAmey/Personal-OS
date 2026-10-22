// @vitest-environment node
// GET /api/auth/github/callback against the real test database; GitHub's
// endpoints are mocked (no network).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth/jwt';
import { authEventNames, createUser, uniqueEmail } from '@/lib/auth/test-helpers';

vi.mock('@/lib/auth/github-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/github-oauth')>()),
  exchangeGithubCode: vi.fn(),
  fetchGithubUser: vi.fn(),
  fetchGithubUserEmails: vi.fn(),
}));

const gh = await import('@/lib/auth/github-oauth');
const exchange = vi.mocked(gh.exchangeGithubCode);
const fetchUser = vi.mocked(gh.fetchGithubUser);
const fetchEmails = vi.mocked(gh.fetchGithubUserEmails);
const { GET } = await import('./route');

let nextId = Math.floor(Math.random() * 1e9);

function callback(opts: { state?: string; cookieState?: string | null; verifier?: string | null; code?: string | null } = {}) {
  const state = opts.state ?? 'state-1';
  const cookies: string[] = [];
  const cookieState = opts.cookieState === undefined ? state : opts.cookieState;
  if (cookieState !== null) cookies.push(`github_oauth_state=${cookieState}`);
  const verifier = opts.verifier === undefined ? 'verifier-1' : opts.verifier;
  if (verifier !== null) cookies.push(`github_oauth_pkce=${verifier}`);
  const code = opts.code === undefined ? 'code-1' : opts.code;
  const qs = new URLSearchParams({ state, ...(code ? { code } : {}) });
  return GET(new Request(`http://localhost:3000/api/auth/github/callback?${qs}`, { headers: { cookie: cookies.join('; ') } }));
}

function githubReturns(email: string, id = ++nextId, verified = true) {
  exchange.mockResolvedValue('gho_token');
  fetchUser.mockResolvedValue({ id, email, name: 'G', avatar_url: 'https://avatars.githubusercontent.com/u/1' });
  fetchEmails.mockResolvedValue([{ email, primary: true, verified }]);
  return id;
}

const sessionUserId = async (res: Response) => {
  const c = res.headers.getSetCookie().find((s) => s.startsWith('session='))!;
  return (await verifySessionToken(c.split(';')[0].slice(8)))?.userId;
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/auth/github/callback', () => {
  it('creates a new verified user from the verified email and sets a session cookie', async () => {
    const email = uniqueEmail('gh');
    const id = githubReturns(email);
    const res = await callback();
    expect(res.status).toBe(307);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.githubId).toBe(String(id));
    expect(user.emailVerified).toBe(true);
    expect(await sessionUserId(res)).toBe(user.id);
    expect(await authEventNames({ userId: user.id })).toEqual(['OAUTH_LOGIN_SUCCESS']);
  });

  it('passes the PKCE verifier to the code exchange', async () => {
    githubReturns(uniqueEmail());
    await callback({ verifier: 'gh-verifier' });
    expect(exchange).toHaveBeenCalledWith('code-1', 'gh-verifier');
  });

  it('links to an existing verified user with the same email', async () => {
    const existing = await createUser();
    githubReturns(existing.email);
    const res = await callback();
    expect(await sessionUserId(res)).toBe(existing.id);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(row.githubId).not.toBeNull();
    expect(row.sessionVersion).toBe(1);
  });

  it('finds an existing user by githubId even when their verified email changed', async () => {
    const id = ++nextId;
    const existing = await createUser({ githubId: String(id) });
    githubReturns(uniqueEmail('changed'), id);
    expect(await sessionUserId(await callback())).toBe(existing.id);
  });

  it('rejects sign-in when GitHub has no verified email, without creating or linking a user', async () => {
    const unverified = uniqueEmail('unverified');
    const id = githubReturns(unverified, undefined, false);
    expect((await callback()).status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: unverified } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { githubId: String(id) } })).toBeNull();
  });

  it('clears the state and PKCE cookies alongside setting the session cookie', async () => {
    githubReturns(uniqueEmail());
    const cookies = (await callback()).headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('session='))).toBe(true);
    expect(cookies.find((c) => c.startsWith('github_oauth_state='))).toMatch(/Max-Age=0/);
    expect(cookies.find((c) => c.startsWith('github_oauth_pkce='))).toMatch(/Max-Age=0/);
  });

  it('rejects when the callback state does not match the state cookie (CSRF)', async () => {
    expect((await callback({ state: 'a', cookieState: 'b' })).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects when there is no state cookie or no PKCE cookie', async () => {
    expect((await callback({ cookieState: null })).status).toBe(400);
    expect((await callback({ verifier: null })).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects when there is no code param', async () => {
    expect((await callback({ code: null })).status).toBe(400);
  });

  it('returns 400 (not 500) when GitHub fails', async () => {
    exchange.mockRejectedValue(new Error('GitHub token exchange failed: 500'));
    expect((await callback()).status).toBe(400);
  });
});
