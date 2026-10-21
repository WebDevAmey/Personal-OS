// @vitest-environment node
// SEC-B-001 regression: lockout race under concurrency, against the real
// test database (no mocks). Before the fix, N parallel wrong guesses each
// wrote failedLoginAttempts = prior + 1 = 1, so the account never locked.
import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from './route';
import { apiRequest, createUser, uniqueIp } from '@/lib/auth/test-helpers';
import * as password from '@/lib/auth/password';

const PASSWORD = 'correct horse battery staple';

describe('SEC-B-001 lockout under concurrent attempts', () => {
  it('20 parallel wrong passwords lock the account, and the correct password is then rejected', async () => {
    const user = await createUser();
    const verify = vi.spyOn(password, 'verifyPassword');

    // Distinct IPs so the per-IP limiter does not mask the lockout logic.
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        POST(apiRequest('/api/auth/login', { email: user.email, password: `wrong-${i}` }, { ip: uniqueIp() })),
      ),
    );
    const statuses = responses.map((r) => r.status);
    // At most 10 can pass the per-email limiter; all others are 401 or 429.
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginAttempts).toBe(5);
    expect(row.lockedUntil).not.toBeNull();
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Attempts are reserved before bcrypt: no more than the budget of real
    // password comparisons ran, however many requests raced.
    expect(verify.mock.calls.length).toBeLessThanOrEqual(5);
    verify.mockRestore();

    const correct = await POST(apiRequest('/api/auth/login', { email: user.email, password: PASSWORD }, { ip: uniqueIp() }));
    expect([401, 429]).toContain(correct.status);
    expect(correct.headers.getSetCookie()).toEqual([]);
  }, 30_000);

  it('parallel guesses below the email limit still cannot exceed 5 password checks', async () => {
    const user = await createUser();
    const verify = vi.spyOn(password, 'verifyPassword');
    const responses = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        POST(apiRequest('/api/auth/login', { email: user.email, password: `wrong-${i}` }, { ip: uniqueIp() })),
      ),
    );
    expect(responses.every((r) => r.status === 401)).toBe(true);
    expect(verify.mock.calls.length).toBe(5);
    verify.mockRestore();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginAttempts).toBe(5);
    expect(row.lockedUntil).not.toBeNull();
  }, 30_000);
});
