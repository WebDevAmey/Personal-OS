// @vitest-environment node
// lib/auth/session.ts against the real test database.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createSessionCookie, getSession, requirePageUser, requireUser, PATHNAME_HEADER } from './session';
import { signSessionToken } from './jwt';
import { createUser } from './test-helpers';

const cookieStore = { get: vi.fn() };
const headerStore = new Headers();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

function reqWith(cookie?: string) {
  return new Request('http://localhost:3000/api/x', { headers: cookie ? { cookie } : {} });
}

beforeEach(() => {
  cookieStore.get.mockReset();
  headerStore.delete(PATHNAME_HEADER);
});

describe('getSession', () => {
  it('returns the userId when the JWT is valid and sessionVersion matches the DB', async () => {
    const user = await createUser();
    const token = await signSessionToken({ userId: user.id, sessionVersion: 0 });
    expect(await getSession(reqWith(`session=${token}`))).toEqual({ userId: user.id });
  });

  it('reads the cookie through next/headers when no Request is passed', async () => {
    const user = await createUser();
    const token = await signSessionToken({ userId: user.id, sessionVersion: 0 });
    cookieStore.get.mockReturnValue({ value: token });
    expect(await getSession()).toEqual({ userId: user.id });
  });

  it('returns null once sessionVersion has been bumped (revoked session)', async () => {
    const user = await createUser();
    const token = await signSessionToken({ userId: user.id, sessionVersion: 0 });
    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await getSession(reqWith(`session=${token}`))).toBeNull();
  });

  it('returns null for a deleted user, a bad token, or no cookie', async () => {
    const token = await signSessionToken({ userId: 'no-such-user', sessionVersion: 0 });
    expect(await getSession(reqWith(`session=${token}`))).toBeNull();
    expect(await getSession(reqWith('session=garbage'))).toBeNull();
    expect(await getSession(reqWith())).toBeNull();
  });

  it('keeps an existing session valid while the password is locked out (SEC-B-007)', async () => {
    const user = await createUser();
    const token = await signSessionToken({ userId: user.id, sessionVersion: 0 });
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) } });
    expect(await getSession(reqWith(`session=${token}`))).toEqual({ userId: user.id });
  });
});

describe('requireUser', () => {
  it('returns a 401 Response without a session', async () => {
    const result = await requireUser(reqWith());
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(await (result as Response).json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('returns the session when signed in', async () => {
    const user = await createUser();
    const cookie = (await createSessionCookie(user)).split(';')[0];
    expect(await requireUser(reqWith(cookie))).toEqual({ userId: user.id });
  });
});

describe('requirePageUser', () => {
  it('redirects to sign-in with the current path from middleware as callbackUrl', async () => {
    cookieStore.get.mockReturnValue(undefined);
    headerStore.set(PATHNAME_HEADER, '/tasks?view=inbox');
    await expect(requirePageUser()).rejects.toThrow('NEXT_REDIRECT:/sign-in?callbackUrl=%2Ftasks%3Fview%3Dinbox');
  });

  it('never puts an off-site URL into callbackUrl', async () => {
    cookieStore.get.mockReturnValue(undefined);
    await expect(requirePageUser('https://evil.example')).rejects.toThrow('NEXT_REDIRECT:/sign-in?callbackUrl=%2Ftoday');
  });

  it('returns the session when signed in', async () => {
    const user = await createUser();
    cookieStore.get.mockReturnValue({ value: await signSessionToken({ userId: user.id, sessionVersion: 0 }) });
    expect(await requirePageUser()).toEqual({ userId: user.id });
  });
});
