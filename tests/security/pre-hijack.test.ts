// @vitest-environment node
// SEC-B-005 regression: account squatting / pre-hijack, end to end through the
// real route handlers and test database. Provider endpoints are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { outbox } from '@/lib/email/transport';
import { apiRequest, cookieHeaderFrom, createUser, uniqueEmail } from '@/lib/auth/test-helpers';

const deferred = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    deferred.push(task);
  },
}));
vi.mock('@/lib/auth/google-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/google-oauth')>()),
  exchangeGoogleCode: vi.fn(),
  verifyGoogleIdToken: vi.fn(),
}));
vi.mock('@/lib/auth/github-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/github-oauth')>()),
  exchangeGithubCode: vi.fn(),
  fetchGithubUser: vi.fn(),
  fetchGithubUserEmails: vi.fn(),
}));

const google = await import('@/lib/auth/google-oauth');
const github = await import('@/lib/auth/github-oauth');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: signup } = await import('@/app/api/auth/signup/route');
const { POST: verifyOtp } = await import('@/app/api/auth/verify-otp/route');
const { GET: googleCallback } = await import('@/app/api/auth/google/callback/route');
const { GET: githubCallback } = await import('@/app/api/auth/github/callback/route');

const SQUATTER_PW = 'squatters secret password';
const OWNER_PW = 'the real owners password';

beforeEach(() => {
  deferred.length = 0;
  vi.clearAllMocks();
});

async function runDeferred() {
  while (deferred.length) await deferred.shift()!();
}

const tryLogin = (email: string, password: string) => login(apiRequest('/api/auth/login', { email, password }));

async function signUpAs(email: string, password: string) {
  const res = await signup(apiRequest('/api/auth/signup', { email, password }));
  await runDeferred();
  const code = outbox.filter((m) => m.to === email).at(-1)!.text.match(/\b(\d{6})\b/)![1];
  return { cookie: cookieHeaderFrom(res), code };
}

/** A squatter row as the OLD sign-up created it: unverified, squatter's password. */
async function legacySquat(email: string) {
  return createUser({ email, password: SQUATTER_PW, emailVerified: false });
}

function googleSignInAs(email: string) {
  vi.mocked(google.exchangeGoogleCode).mockResolvedValue({ access_token: 'ya29.a', expires_in: 3600, id_token: 'i' });
  vi.mocked(google.verifyGoogleIdToken).mockResolvedValue({ sub: `g-${randomUUID()}`, email, email_verified: true });
  return googleCallback(
    new Request('http://localhost:3000/api/auth/google/callback?code=c&state=s', {
      headers: { cookie: 'google_oauth_state=s; google_oauth_pkce=v' },
    }),
  );
}

function githubSignInAs(email: string) {
  vi.mocked(github.exchangeGithubCode).mockResolvedValue('gho_x');
  vi.mocked(github.fetchGithubUser).mockResolvedValue({ id: Math.floor(Math.random() * 1e9), email });
  vi.mocked(github.fetchGithubUserEmails).mockResolvedValue([{ email, primary: true, verified: true }]);
  return githubCallback(
    new Request('http://localhost:3000/api/auth/github/callback?code=c&state=s', {
      headers: { cookie: 'github_oauth_state=s; github_oauth_pkce=v' },
    }),
  );
}

describe('SEC-B-005 account pre-hijack', () => {
  it('squat → Google link: the squatter password stops working and the row is the owner’s', async () => {
    const email = uniqueEmail('victim');
    const squat = await legacySquat(email);
    expect((await googleSignInAs(email)).status).toBe(307);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: squat.id } });
    expect(row.emailVerified).toBe(true);
    expect(row.password).toBeNull();
    expect(row.sessionVersion).toBe(1);
    expect((await tryLogin(email, SQUATTER_PW)).status).toBe(401);
  });

  it('squat → GitHub link: same outcome', async () => {
    const email = uniqueEmail('victim');
    await legacySquat(email);
    expect((await githubSignInAs(email)).status).toBe(307);
    expect((await tryLogin(email, SQUATTER_PW)).status).toBe(401);
  });

  it('squat → owner signs up and verifies the code: owner password works, squatter password does not', async () => {
    const email = uniqueEmail('victim');
    await legacySquat(email);
    const owner = await signUpAs(email, OWNER_PW);
    expect((await verifyOtp(apiRequest('/api/auth/verify-otp', { email, code: owner.code }, { cookie: owner.cookie }))).status).toBe(200);

    expect((await tryLogin(email, SQUATTER_PW)).status).toBe(401);
    expect((await tryLogin(email, OWNER_PW)).status).toBe(200);
  });

  it('new flow: a squatter’s pending sign-up neither creates nor blocks the account', async () => {
    const email = uniqueEmail('victim');
    const squatter = await signUpAs(email, SQUATTER_PW);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    // The owner types the code the squatter caused to be emailed, in the
    // owner's own browser: rejected, because it is bound to the squatter's.
    expect((await verifyOtp(apiRequest('/api/auth/verify-otp', { email, code: squatter.code }))).status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    // The owner can still sign up normally.
    const owner = await signUpAs(email, OWNER_PW);
    expect((await verifyOtp(apiRequest('/api/auth/verify-otp', { email, code: owner.code }, { cookie: owner.cookie }))).status).toBe(200);
    expect((await tryLogin(email, OWNER_PW)).status).toBe(200);
    expect((await tryLogin(email, SQUATTER_PW)).status).toBe(401);
  });

  it('new flow: the owner can sign in with Google while a squatter’s sign-up is pending, and the squatter cannot finish it', async () => {
    const email = uniqueEmail('victim');
    const squatter = await signUpAs(email, SQUATTER_PW);
    expect((await googleSignInAs(email)).status).toBe(307);
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(created.password).toBeNull();

    // Even with the right code and cookie, completing the stale sign-up does
    // not set a password on the now-verified account.
    await verifyOtp(apiRequest('/api/auth/verify-otp', { email, code: squatter.code }, { cookie: squatter.cookie }));
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).password).toBeNull();
    expect((await tryLogin(email, SQUATTER_PW)).status).toBe(401);
  });
});
