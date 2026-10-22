// @vitest-environment node
// SEC-B-009: logout and "sign out everywhere".
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createSessionCookie, getSession } from '@/lib/auth/session';
import { apiRequest, authEventNames, createUser } from '@/lib/auth/test-helpers';
import { POST as logout } from './route';
import { POST as revokeAll } from '../sessions/revoke-all/route';

async function signedIn() {
  const user = await createUser();
  const cookie = (await createSessionCookie(user)).split(';')[0];
  return { user, cookie };
}

const asRequest = (cookie: string) => new Request('http://localhost:3000/', { headers: { cookie } });

describe('POST /api/auth/logout', () => {
  it('clears the session cookie and records LOGOUT', async () => {
    const { user, cookie } = await signedIn();
    const res = await logout(apiRequest('/api/auth/logout', undefined, { cookie }));
    expect(res.status).toBe(200);
    const [cleared] = res.headers.getSetCookie();
    expect(cleared).toMatch(/^session=; /);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('Path=/');
    expect(await authEventNames({ userId: user.id })).toEqual(['LOGOUT']);
  });

  it('succeeds without a session (idempotent)', async () => {
    const res = await logout(apiRequest('/api/auth/logout'));
    expect(res.status).toBe(200);
  });

  it('rejects a cross-site logout post', async () => {
    const { cookie } = await signedIn();
    const res = await logout(apiRequest('/api/auth/logout', undefined, { cookie, origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe('POST /api/auth/sessions/revoke-all', () => {
  it('bumps sessionVersion so every existing token stops working', async () => {
    const { user, cookie } = await signedIn();
    const otherDevice = (await createSessionCookie(user)).split(';')[0];

    const res = await revokeAll(apiRequest('/api/auth/sessions/revoke-all', undefined, { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/^session=; .*Max-Age=0/);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.sessionVersion).toBe(1);
    expect(await getSession(asRequest(cookie))).toBeNull();
    expect(await getSession(asRequest(otherDevice))).toBeNull();
    expect(await authEventNames({ userId: user.id })).toEqual(['SESSIONS_REVOKED']);
  });

  it('returns 401 without a valid session', async () => {
    const res = await revokeAll(apiRequest('/api/auth/sessions/revoke-all'));
    expect(res.status).toBe(401);
  });

  it('rejects a cross-site request before touching the session', async () => {
    const { user, cookie } = await signedIn();
    const res = await revokeAll(apiRequest('/api/auth/sessions/revoke-all', undefined, { cookie, origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(0);
  });
});
