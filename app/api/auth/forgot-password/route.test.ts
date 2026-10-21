// @vitest-environment node
// POST /api/auth/forgot-password against the real test database.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { outbox } from '@/lib/email/transport';
import { apiRequest, authEventNames, createUser, uniqueEmail, uniqueIp } from '@/lib/auth/test-helpers';

// The real after() needs Next's request scope; capture the task so a test can
// run it explicitly, as Next would after sending the response.
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

beforeEach(() => {
  deferred.length = 0;
});

describe('POST /api/auth/forgot-password', () => {
  it('sends a reset code when the email exists', async () => {
    const user = await createUser();
    const res = await POST(apiRequest('/api/auth/forgot-password', { email: user.email }));
    expect(res.status).toBe(200);
    await runDeferred();
    expect(await prisma.verificationToken.count({ where: { email: user.email, type: 'PASSWORD_RESET' } })).toBe(1);
    expect(outbox.filter((m) => m.to === user.email)).toHaveLength(1);
    expect(await authEventNames({ userId: user.id })).toEqual(['PASSWORD_RESET_REQUESTED']);
  });

  it('returns the identical response whether or not the email is registered, and sends nothing for unknown emails', async () => {
    const user = await createUser();
    const unknown = uniqueEmail();
    const a = await POST(apiRequest('/api/auth/forgot-password', { email: user.email }));
    const b = await POST(apiRequest('/api/auth/forgot-password', { email: unknown }));
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
    await runDeferred();
    expect(outbox.filter((m) => m.to === unknown)).toHaveLength(0);
    expect(await prisma.verificationToken.count({ where: { email: unknown } })).toBe(0);
  });

  it('does not issue a second code within 60 seconds for the same email', async () => {
    const user = await createUser();
    await POST(apiRequest('/api/auth/forgot-password', { email: user.email }));
    await POST(apiRequest('/api/auth/forgot-password', { email: user.email }));
    await runDeferred();
    expect(outbox.filter((m) => m.to === user.email)).toHaveLength(1);
  });

  it('returns 400 for a malformed JSON body', async () => {
    expect((await POST(apiRequest('/api/auth/forgot-password', '{x'))).status).toBe(400);
  });

  it('limits requests per IP with 429 (10/hour)', async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await POST(apiRequest('/api/auth/forgot-password', { email: uniqueEmail() }, { ip }))).status);
    }
    expect(statuses[9]).toBe(200);
    expect(statuses[10]).toBe(429);
  });
});
