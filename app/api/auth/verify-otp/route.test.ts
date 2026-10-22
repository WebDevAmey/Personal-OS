// @vitest-environment node
// POST /api/auth/verify-otp (SIGN_UP) against the real test database.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { outbox } from '@/lib/email/transport';
import { verifyPassword } from '@/lib/auth/password';
import { apiRequest, authEventNames, cookieHeaderFrom, createUser, uniqueEmail } from '@/lib/auth/test-helpers';

const deferred = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    deferred.push(task);
  },
}));

const { POST: signup } = await import('../signup/route');
const { POST: verify } = await import('./route');

const PASSWORD = 'a long enough password';

async function signUp(email: string, password = PASSWORD) {
  const res = await signup(apiRequest('/api/auth/signup', { email, password }));
  while (deferred.length) await deferred.shift()!();
  const mail = outbox.filter((m) => m.to === email).at(-1)!;
  return { cookie: cookieHeaderFrom(res), code: mail.text.match(/\b(\d{6})\b/)![1] };
}

function wrong(code: string) {
  return code === '000000' ? '111111' : '000000';
}

beforeEach(() => {
  deferred.length = 0;
});

describe('POST /api/auth/verify-otp', () => {
  it('creates the verified account with the sign-up password on a correct code from the same browser', async () => {
    const email = uniqueEmail();
    const { cookie, code } = await signUp(email);
    const res = await verify(apiRequest('/api/auth/verify-otp', { email, code, type: 'SIGN_UP' }, { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/^signup_binding=; .*Max-Age=0/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(true);
    expect(await verifyPassword(PASSWORD, user.password!)).toBe(true);
    expect(await prisma.verificationToken.count({ where: { email } })).toBe(0);
    expect(await authEventNames({ email })).toEqual(['OTP_SENT', 'OTP_VERIFIED']);
  });

  it('accepts the body the verify-otp page sends ({ email, code, type })', async () => {
    const email = uniqueEmail();
    const { cookie, code } = await signUp(email);
    const res = await verify(apiRequest('/api/auth/verify-otp', { email, code, type: 'SIGN_UP' }, { cookie }));
    expect(res.status).toBe(200);
  });

  it('rejects the legacy { otp } field name instead of silently passing', async () => {
    const email = uniqueEmail();
    const { cookie, code } = await signUp(email);
    const res = await verify(apiRequest('/api/auth/verify-otp', { email, otp: code, type: 'SIGN_UP' }, { cookie }));
    expect(res.status).toBe(400);
  });

  it('rejects the right code entered in a different browser (no binding cookie) and creates nothing', async () => {
    const email = uniqueEmail();
    const { code } = await signUp(email);
    const res = await verify(apiRequest('/api/auth/verify-otp', { email, code }));
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('rejects an incorrect code and reserves the attempt', async () => {
    const email = uniqueEmail();
    const { cookie, code } = await signUp(email);
    const res = await verify(apiRequest('/api/auth/verify-otp', { email, code: wrong(code) }, { cookie }));
    expect(res.status).toBe(400);
    const token = await prisma.verificationToken.findFirstOrThrow({ where: { email } });
    expect(token.attempts).toBe(1);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('caps guesses at 5 per token even under concurrent requests', async () => {
    const email = uniqueEmail();
    const { cookie, code } = await signUp(email);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => verify(apiRequest('/api/auth/verify-otp', { email, code: wrong(code) }, { cookie }))),
    );
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((b) => b.error === 'Incorrect code')).toHaveLength(5);
    // The right code no longer works once the budget is spent.
    const after = await verify(apiRequest('/api/auth/verify-otp', { email, code }, { cookie }));
    expect(after.status).toBe(400);
  }, 20_000);

  it('rejects when no matching token exists', async () => {
    const res = await verify(apiRequest('/api/auth/verify-otp', { email: uniqueEmail(), code: '123456' }));
    expect(res.status).toBe(400);
  });

  it('is single use', async () => {
    const email = uniqueEmail();
    const { cookie, code } = await signUp(email);
    const [a, b] = await Promise.all([
      verify(apiRequest('/api/auth/verify-otp', { email, code }, { cookie })),
      verify(apiRequest('/api/auth/verify-otp', { email, code }, { cookie })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('does not accept PASSWORD_RESET codes (reset-password verifies those)', async () => {
    const res = await verify(apiRequest('/api/auth/verify-otp', { email: uniqueEmail(), code: '123456', type: 'PASSWORD_RESET' }));
    expect(res.status).toBe(400);
  });

  it('does not change the password of an account that became verified meanwhile', async () => {
    const email = uniqueEmail();
    const { cookie, code } = await signUp(email);
    const owner = await createUser({ email, password: 'the owners own password' });
    const res = await verify(apiRequest('/api/auth/verify-otp', { email, code }, { cookie }));
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(await verifyPassword('the owners own password', row.password!)).toBe(true);
  });

  it('returns 400 for a malformed JSON body', async () => {
    expect((await verify(apiRequest('/api/auth/verify-otp', '{nope'))).status).toBe(400);
  });
});
