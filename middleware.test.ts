// @vitest-environment node
// middleware.ts: deny-by-default route protection, CSRF filter, correlation id.
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware, isPublicPath, config } from './middleware';
import { signSessionToken } from '@/lib/auth/jwt';

const BASE = 'http://localhost:3000';

function request(path: string, init: { method?: string; cookie?: string; origin?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.origin) headers.set('origin', init.origin);
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? 'GET', headers });
}

async function sessionCookie() {
  return `session=${await signSessionToken({ userId: 'user-1', sessionVersion: 0 })}`;
}

const PROTECTED_PAGES = ['/today', '/tasks', '/tasks/abc', '/upcoming', '/inbox', '/projects', '/projects/p1', '/memory', '/settings', '/settings/sessions'];
const PROTECTED_API = ['/api/command', '/api/command/confirm', '/api/tasks', '/api/tasks/t1', '/api/briefing', '/api/auth/sessions/revoke-all', '/api/auth/passkey/register/options', '/api/some-future-route'];

describe('middleware route protection', () => {
  it.each(PROTECTED_PAGES)('redirects anonymous %s to /sign-in with a callbackUrl', async (path) => {
    const res = await middleware(request(`${path}?x=1`));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('callbackUrl')).toBe(`${path}?x=1`);
  });

  it.each(PROTECTED_API)('returns 401 JSON for anonymous %s', async (path) => {
    const res = await middleware(request(path));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('lets a request with a valid session through and forwards correlation headers', async () => {
    const res = await middleware(request('/today', { cookie: await sessionCookie() }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('x-middleware-request-x-pos-pathname')).toBe('/today');
  });

  it('rejects a forged or garbage session cookie', async () => {
    const res = await middleware(request('/api/tasks', { cookie: 'session=eyJhbGciOiJub25lIn0.e30.' }));
    expect(res.status).toBe(401);
  });

  it('ignores the dev cookie name in production (expects __Host-session)', async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      const res = await middleware(request('/today', { cookie: await sessionCookie() }));
      expect(res.status).toBe(307);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev!;
    }
  });

  it.each(['/', '/sign-in', '/sign-up', '/verify-otp', '/forgot-password', '/reset-password', '/lottie/morning.json', '/file.svg'])(
    'allows public path %s anonymously',
    async (path) => {
      const res = await middleware(request(path));
      expect(res.status).toBe(200);
    },
  );

  it.each([
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/verify-otp',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/logout',
    '/api/auth/google',
    '/api/auth/google/callback',
    '/api/auth/github/callback',
    '/api/auth/passkey/auth/options',
    '/api/auth/passkey/auth/verify',
    '/api/inngest',
  ])('treats %s as public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it('does not treat look-alike prefixes as public', () => {
    expect(isPublicPath('/api/auth/loginx')).toBe(false);
    expect(isPublicPath('/api/auth/sessions/revoke-all')).toBe(false);
    expect(isPublicPath('/api/auth/passkey/register/verify')).toBe(false);
    expect(isPublicPath('/api/tasks.json')).toBe(false);
    expect(isPublicPath('/sign-in-evil')).toBe(false);
  });

  it('matcher covers everything but build assets', () => {
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico).*)']);
  });
});

describe('middleware CSRF filter', () => {
  it('blocks a cross-origin POST to an API route before auth', async () => {
    const res = await middleware(request('/api/tasks', { method: 'POST', origin: 'https://evil.example', cookie: await sessionCookie() }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'CSRF_BLOCKED' });
  });

  it('blocks a cross-origin POST to a public auth route (login CSRF)', async () => {
    const res = await middleware(request('/api/auth/login', { method: 'POST', origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });

  it('allows a same-origin POST', async () => {
    const res = await middleware(request('/api/tasks', { method: 'POST', origin: BASE, cookie: await sessionCookie() }));
    expect(res.status).toBe(200);
  });

  it('exempts the signed server-to-server Inngest endpoint', async () => {
    const res = await middleware(request('/api/inngest', { method: 'POST' }));
    expect(res.status).toBe(200);
  });
});
