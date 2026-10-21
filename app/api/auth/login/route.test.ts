// @vitest-environment node
// POST /api/auth/login against the real test database.
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from './route';
import { verifySessionToken } from '@/lib/auth/jwt';
import { apiRequest, authEventNames, createUser, setCookies, uniqueEmail, uniqueIp } from '@/lib/auth/test-helpers';

const PASSWORD = 'correct horse battery staple';

function login(email: string, password: string, opts: Parameters<typeof apiRequest>[2] = {}) {
  return POST(apiRequest('/api/auth/login', { email, password }, opts));
}

describe('POST /api/auth/login', () => {
  it('sets a hardened session cookie on correct credentials and records LOGIN_SUCCESS', async () => {
    const user = await createUser();
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(200);
    const [cookie] = setCookies(res);
    expect(cookie).toMatch(/^session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);
    const token = cookie.split(';')[0].slice('session='.length);
    expect(await verifySessionToken(token)).toEqual({ userId: user.id, sessionVersion: 0 });
    expect(await authEventNames({ userId: user.id })).toEqual(['LOGIN_SUCCESS']);
  });

  it('normalises the email (case and whitespace)', async () => {
    const user = await createUser();
    const res = await login(`  ${user.email.toUpperCase()} `, PASSWORD);
    expect(res.status).toBe(200);
  });

  it('issues a new token on every sign-in (rotation)', async () => {
    const user = await createUser();
    const a = setCookies(await login(user.email, PASSWORD))[0];
    await new Promise((r) => setTimeout(r, 1100));
    const b = setCookies(await login(user.email, PASSWORD))[0];
    expect(a).not.toEqual(b);
  });

  it('resets failedLoginAttempts and lockedUntil on a successful login', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 3 } });
    expect((await login(user.email, PASSWORD)).status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it('rejects an incorrect password and increments failedLoginAttempts', async () => {
    const user = await createUser();
    const res = await login(user.email, 'wrong password');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Incorrect email or password' });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginAttempts).toBe(1);
    expect(await authEventNames({ userId: user.id })).toEqual(['LOGIN_FAILURE']);
  });

  it('locks the account for 15 minutes after the 5th consecutive failure', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) await login(user.email, 'wrong password');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginAttempts).toBe(5);
    const ms = after.lockedUntil!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(14 * 60_000);
    expect(ms).toBeLessThanOrEqual(15 * 60_000 + 1000);
    expect(await authEventNames({ userId: user.id })).toContain('ACCOUNT_LOCKED');
  }, 15_000);

  it('rejects login while the account is locked, even with the correct password, with the generic 401', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 10 * 60_000) } });
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Incorrect email or password' });
    expect(setCookies(res)).toEqual([]);
  });

  it('gives a fresh attempt budget after a lockout has expired, and re-locks after 5 more failures', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) } });
    await login(user.email, 'wrong password');
    let row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginAttempts).toBe(1);
    expect(row.lockedUntil).toBeNull();
    for (let i = 0; i < 4; i++) await login(user.email, 'wrong password');
    row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginAttempts).toBe(5);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  }, 15_000);

  it('allows the correct password after an expired lock', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) } });
    expect((await login(user.email, PASSWORD)).status).toBe(200);
  });

  it('rejects login for an unverified (legacy) account after the password check', async () => {
    const user = await createUser({ emailVerified: false });
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(403);
    expect(setCookies(res)).toEqual([]);
  });

  it('returns 400 for a malformed JSON body', async () => {
    const res = await POST(apiRequest('/api/auth/login', '{not json'));
    expect(res.status).toBe(400);
  });
});

describe('SEC-B-006 enumeration resistance', () => {
  it('answers unknown email, OAuth-only account, wrong password and locked account identically', async () => {
    const pw = await createUser();
    const oauthOnly = await createUser({ password: null });
    const locked = await createUser();
    await prisma.user.update({ where: { id: locked.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) } });

    const responses = await Promise.all([
      login(uniqueEmail('nobody'), PASSWORD),
      login(oauthOnly.email, PASSWORD),
      login(pw.email, 'wrong password'),
      login(locked.email, PASSWORD),
    ]);
    const shapes = await Promise.all(responses.map(async (r) => ({ status: r.status, body: await r.json() })));
    for (const s of shapes) expect(s).toEqual({ status: 401, body: { error: 'Incorrect email or password' } });
  });

  it('does bcrypt work for an unknown email (no fast path)', async () => {
    const known = await createUser();
    const time = async (email: string) => {
      const t = performance.now();
      await login(email, 'wrong password');
      return performance.now() - t;
    };
    await time(uniqueEmail()); // warm the dummy hash
    const unknown = await time(uniqueEmail());
    const wrong = await time(known.email);
    // bcrypt cost 12 takes well over 50 ms; an early return would take ~1-5 ms.
    expect(unknown).toBeGreaterThan(50);
    expect(unknown).toBeGreaterThan(wrong * 0.4);
  });
});

describe('ADR-012 rate limiting on login (SEC-B-001)', () => {
  it('returns 429 with Retry-After once one IP exceeds 20 attempts in 15 minutes', async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await POST(apiRequest('/api/auth/login', { email: uniqueEmail(), password: 'x' }, { ip }))).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
    const res = await POST(apiRequest('/api/auth/login', { email: uniqueEmail(), password: 'x' }, { ip }));
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 30_000);

  it('returns 429 once one email exceeds 10 attempts in 15 minutes, across IPs, and records LOGIN_RATE_LIMITED', async () => {
    const email = uniqueEmail('target');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(email, 'x')).status);
    expect(statuses[10]).toBe(429);
    expect(await authEventNames({ email })).toContain('LOGIN_RATE_LIMITED');
  }, 30_000);
});

describe('SEC-B-010 login CSRF', () => {
  it('rejects a cross-site form post (text/plain body)', async () => {
    const user = await createUser();
    const res = await POST(
      apiRequest('/api/auth/login', JSON.stringify({ email: user.email, password: PASSWORD }), { origin: 'https://evil.example', contentType: 'text/plain' }),
    );
    expect(res.status).toBe(403);
    expect(setCookies(res)).toEqual([]);
  });

  it('rejects a same-origin text/plain body with 415', async () => {
    const user = await createUser();
    const res = await POST(apiRequest('/api/auth/login', JSON.stringify({ email: user.email, password: PASSWORD }), { contentType: 'text/plain' }));
    expect(res.status).toBe(415);
  });
});
