// @vitest-environment node
// SEC-B-002 regression: reset-code issuance is capped per email, atomically.
import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { outbox } from '@/lib/email/transport';
import { emailHash } from '@/lib/security/auth-rate-limit';
import { apiRequest, createUser } from '@/lib/auth/test-helpers';

const deferred = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    deferred.push(task);
  },
}));

const { POST } = await import('./route');

async function requestAndRun(email: string) {
  await POST(apiRequest('/api/auth/forgot-password', { email }));
  while (deferred.length) await deferred.shift()!();
}

async function expireBurstWindow(email: string) {
  await prisma.rateLimitAttempt.updateMany({
    where: { key: `reset-issue-burst:email:${emailHash(email)}` },
    data: { windowStart: new Date(Date.now() - 61_000) },
  });
}

describe('SEC-B-002 reset-code issuance cap', () => {
  it('issues at most 5 codes per email per 24 h, even with the 60 s throttle elapsed each time', async () => {
    const user = await createUser();
    for (let i = 0; i < 8; i++) {
      await requestAndRun(user.email);
      await expireBurstWindow(user.email);
    }
    expect(outbox.filter((m) => m.to === user.email)).toHaveLength(5);
    // Only the newest code is ever valid: older ones were deleted on issue.
    expect(await prisma.verificationToken.count({ where: { email: user.email, type: 'PASSWORD_RESET' } })).toBe(1);
  }, 30_000);

  it('parallel requests cannot mint more than one code inside the 60 s throttle (atomic issuance)', async () => {
    const user = await createUser();
    await Promise.all(Array.from({ length: 10 }, () => POST(apiRequest('/api/auth/forgot-password', { email: user.email }))));
    await Promise.all(deferred.splice(0).map((task) => task()));
    expect(outbox.filter((m) => m.to === user.email)).toHaveLength(1);
    expect(await prisma.verificationToken.count({ where: { email: user.email, type: 'PASSWORD_RESET' } })).toBe(1);
  }, 30_000);
});
