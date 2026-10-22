// @vitest-environment node
// POST /api/auth/signup against the real test database.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { outbox } from '@/lib/email/transport';
import { verifyPassword } from '@/lib/auth/password';
import { apiRequest, authEventNames, createUser, setCookies, uniqueEmail, uniqueIp } from '@/lib/auth/test-helpers';

const deferred = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    deferred.push(task);
  },
}));

const { POST } = await import('./route');

async function runDeferred() {
  while (deferred.length) await deferred.shift()!();
}

const PASSWORD = 'a long enough password';

beforeEach(() => {
  deferred.length = 0;
});

describe('POST /api/auth/signup', () => {
  it('does not create a user yet; stores a pending token and emails a code (SEC-B-005)', async () => {
    const email = uniqueEmail('new');
    const res = await POST(apiRequest('/api/auth/signup', { email, password: PASSWORD }));
    expect(res.status).toBe(200);
    await runDeferred();

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    const token = await prisma.verificationToken.findFirstOrThrow({ where: { email, type: 'SIGN_UP' } });
    const payload = token.payload as { passwordHash: string; bindingHash: string };
    expect(await verifyPassword(PASSWORD, payload.passwordHash)).toBe(true);
    expect(payload.bindingHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.otpHash).not.toMatch(/^\d{6}$/);
    const mail = outbox.filter((m) => m.to === email);
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toMatch(/\b\d{6}\b/);
    expect(await authEventNames({ email })).toEqual(['OTP_SENT']);
  });

  it('sets an HttpOnly sign-up binding cookie', async () => {
    const res = await POST(apiRequest('/api/auth/signup', { email: uniqueEmail(), password: PASSWORD }));
    const [cookie] = setCookies(res);
    expect(cookie).toMatch(/^signup_binding=[\w-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('SEC-B-006: answers identically for an existing verified email and emails the owner a notice instead of a code', async () => {
    const owner = await createUser();
    const fresh = uniqueEmail();
    const [a, b] = await Promise.all([
      POST(apiRequest('/api/auth/signup', { email: owner.email, password: PASSWORD })),
      POST(apiRequest('/api/auth/signup', { email: fresh, password: PASSWORD })),
    ]);
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
    await runDeferred();

    const mail = outbox.filter((m) => m.to === owner.email);
    expect(mail).toHaveLength(1);
    expect(mail[0].text).not.toMatch(/\b\d{6}\b/);
    expect(await prisma.verificationToken.count({ where: { email: owner.email } })).toBe(0);
    // The existing account's password is untouched.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(await verifyPassword('correct horse battery staple', row.password!)).toBe(true);
  });

  it('keeps only the newest sign-up code per email', async () => {
    const email = uniqueEmail();
    await POST(apiRequest('/api/auth/signup', { email, password: PASSWORD }));
    await POST(apiRequest('/api/auth/signup', { email, password: PASSWORD }));
    await runDeferred();
    expect(await prisma.verificationToken.count({ where: { email, type: 'SIGN_UP' } })).toBe(1);
  });

  it('returns 400 for a password shorter than 12 characters, naming only the field (SEC-B-022, SEC-B-024)', async () => {
    const res = await POST(apiRequest('/api/auth/signup', { email: uniqueEmail(), password: 'short-pass' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid input', fields: ['password'] });
  });

  it('returns 400 for a malformed JSON body', async () => {
    const res = await POST(apiRequest('/api/auth/signup', '{oops'));
    expect(res.status).toBe(400);
  });

  it('limits sign-ups per IP (10/hour) with 429', async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await POST(apiRequest('/api/auth/signup', { email: uniqueEmail(), password: PASSWORD }, { ip }))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  }, 30_000);

  it('rejects cross-origin posts', async () => {
    const res = await POST(apiRequest('/api/auth/signup', { email: uniqueEmail(), password: PASSWORD }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });
});
