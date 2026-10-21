// @vitest-environment node
// POST /api/auth/reset-password against the real test database.
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { outbox } from '@/lib/email/transport';
import { sendPasswordResetOtp } from '@/lib/auth/otp';
import { verifyPassword } from '@/lib/auth/password';
import { signSessionToken } from '@/lib/auth/jwt';
import { getSession } from '@/lib/auth/session';
import { apiRequest, authEventNames, createUser, uniqueEmail } from '@/lib/auth/test-helpers';
import { POST } from './route';

const NEW_PASSWORD = 'a brand new long password';

async function issue(email: string): Promise<string> {
  await sendPasswordResetOtp(email);
  return outbox.filter((m) => m.to === email).at(-1)!.text.match(/\b(\d{6})\b/)![1];
}

const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

function reset(email: string, code: string, newPassword = NEW_PASSWORD) {
  return POST(apiRequest('/api/auth/reset-password', { email, code, newPassword }));
}

describe('POST /api/auth/reset-password', () => {
  it('resets the password, revokes every session and clears the cookie on a correct code', async () => {
    const user = await createUser();
    const oldToken = await signSessionToken({ userId: user.id, sessionVersion: 0 });
    const code = await issue(user.email);

    const res = await reset(user.email, code);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/^session=; .*Max-Age=0/);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(NEW_PASSWORD, row.password!)).toBe(true);
    expect(row.sessionVersion).toBe(1);
    const req = new Request('http://localhost:3000/', { headers: { cookie: `session=${oldToken}` } });
    expect(await getSession(req)).toBeNull();
    expect(await authEventNames({ userId: user.id })).toContain('PASSWORD_RESET_COMPLETED');
  });

  it('SEC-B-023: clears the lockout and deletes every reset code for the email', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 600_000) } });
    const code = await issue(user.email);
    // A stray second token (e.g. issued by an older deployment) must not survive.
    await prisma.verificationToken.create({
      data: { email: user.email, type: 'PASSWORD_RESET', otpHash: 'x', expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await reset(user.email, code)).status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(await prisma.verificationToken.count({ where: { email: user.email, type: 'PASSWORD_RESET' } })).toBe(0);
  });

  it('rejects an incorrect code and reserves the attempt', async () => {
    const user = await createUser();
    const code = await issue(user.email);
    const res = await reset(user.email, wrong(code));
    expect(res.status).toBe(400);
    const token = await prisma.verificationToken.findFirstOrThrow({ where: { email: user.email } });
    expect(token.attempts).toBe(1);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword('correct horse battery staple', row.password!)).toBe(true);
  });

  it('rejects when no code exists', async () => {
    expect((await reset(uniqueEmail(), '123456')).status).toBe(400);
  });

  it('caps guesses at 5 per token even under concurrent requests', async () => {
    const user = await createUser();
    const code = await issue(user.email);
    const results = await Promise.all(Array.from({ length: 8 }, () => reset(user.email, wrong(code))));
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((b) => b.error === 'Incorrect code')).toHaveLength(5);
    expect((await reset(user.email, code)).status).toBe(400);
  }, 20_000);

  it('is single use under a race', async () => {
    const user = await createUser();
    const code = await issue(user.email);
    const [a, b] = await Promise.all([reset(user.email, code), reset(user.email, code, 'another long new password')]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it('enforces the new-password policy (SEC-B-022)', async () => {
    const user = await createUser();
    const code = await issue(user.email);
    const res = await reset(user.email, code, 'short');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid input', fields: ['newPassword'] });
  });

  it('returns 400 for a malformed JSON body', async () => {
    expect((await POST(apiRequest('/api/auth/reset-password', '{x'))).status).toBe(400);
  });
});

describe('SEC-B-002 total reset guesses per email', () => {
  it('rejects attempt 11 within 24 h even with a fresh, correct code', async () => {
    const user = await createUser();
    // Two codes x 5 wrong guesses = 10 guesses, spread across tokens.
    for (let t = 0; t < 2; t++) {
      const code = await issue(user.email);
      for (let i = 0; i < 5; i++) expect((await reset(user.email, wrong(code))).status).toBe(400);
    }
    const fresh = await issue(user.email);
    const res = await reset(user.email, fresh);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(NEW_PASSWORD, row.password!)).toBe(false);
  }, 30_000);
});
