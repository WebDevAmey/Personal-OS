// Retention purge of the security tables (docs/03 §6, SEC-R-012), against the
// real test database. Rows are tagged with unique keys/emails so parallel
// fixtures in other files are never counted.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/test-helpers';
import { RETENTION, purgeSecurityTables } from './retention';

const NOW = new Date('2027-03-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const tag = randomUUID();
const userIds: string[] = [];

afterAll(async () => {
  await prisma.rateLimitAttempt.deleteMany({ where: { key: { startsWith: `ret-${tag}` } } });
  await prisma.authEvent.deleteMany({ where: { email: { startsWith: `ret-${tag}` } } });
  await prisma.verificationToken.deleteMany({ where: { email: { startsWith: `ret-${tag}` } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe('purgeSecurityTables', () => {
  it('deletes only rows past their retention window, for every table', async () => {
    const user = await createUser();
    userIds.push(user.id);

    await prisma.rateLimitAttempt.createMany({
      data: [
        { key: `ret-${tag}-old`, windowStart: ago(RETENTION.rateLimitAttemptMs + MIN) },
        { key: `ret-${tag}-fresh`, windowStart: ago(RETENTION.rateLimitAttemptMs - MIN) },
      ],
    });
    await prisma.authEvent.createMany({
      data: [
        { type: 'LOGIN_FAILURE', email: `ret-${tag}-old`, createdAt: ago(RETENTION.authEventMs + MIN) },
        { type: 'LOGIN_FAILURE', email: `ret-${tag}-fresh`, createdAt: ago(RETENTION.authEventMs - MIN) },
      ],
    });
    await prisma.webAuthnChallenge.createMany({
      data: [
        { userId: user.id, challenge: `ret-${tag}-old`, expiresAt: ago(RETENTION.webAuthnChallengeGraceMs + MIN) },
        { userId: user.id, challenge: `ret-${tag}-fresh`, expiresAt: ago(RETENTION.webAuthnChallengeGraceMs - MIN) },
      ],
    });
    await prisma.verificationToken.createMany({
      data: [
        { email: `ret-${tag}-old`, type: 'SIGN_UP', otpHash: 'x', expiresAt: ago(RETENTION.verificationTokenGraceMs + MIN) },
        { email: `ret-${tag}-fresh`, type: 'SIGN_UP', otpHash: 'x', expiresAt: ago(RETENTION.verificationTokenGraceMs - MIN) },
      ],
    });

    const result = await purgeSecurityTables({ now: NOW });
    for (const n of Object.values(result)) expect(n).toBeGreaterThanOrEqual(1);

    const keys = (await prisma.rateLimitAttempt.findMany({ where: { key: { startsWith: `ret-${tag}` } } })).map((r) => r.key);
    expect(keys).toEqual([`ret-${tag}-fresh`]);
    const events = (await prisma.authEvent.findMany({ where: { email: { startsWith: `ret-${tag}` } } })).map((r) => r.email);
    expect(events).toEqual([`ret-${tag}-fresh`]);
    const challenges = (await prisma.webAuthnChallenge.findMany({ where: { userId: user.id } })).map((r) => r.challenge);
    expect(challenges).toEqual([`ret-${tag}-fresh`]);
    const tokens = (await prisma.verificationToken.findMany({ where: { email: { startsWith: `ret-${tag}` } } })).map((r) => r.email);
    expect(tokens).toEqual([`ret-${tag}-fresh`]);
  });

  it('works through a backlog larger than one batch', async () => {
    const old = ago(RETENTION.rateLimitAttemptMs + MIN);
    await prisma.rateLimitAttempt.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({ key: `ret-${tag}-batch-${i}`, windowStart: old })),
    });
    const result = await purgeSecurityTables({ now: NOW, batch: 3 });
    expect(result.rateLimitAttempts).toBeGreaterThanOrEqual(7);
    expect(await prisma.rateLimitAttempt.count({ where: { key: { startsWith: `ret-${tag}-batch` } } })).toBe(0);
  });

  it('is a no-op when nothing has expired', async () => {
    await prisma.rateLimitAttempt.create({ data: { key: `ret-${tag}-now`, windowStart: NOW } });
    await purgeSecurityTables({ now: NOW });
    expect(await prisma.rateLimitAttempt.count({ where: { key: `ret-${tag}-now` } })).toBe(1);
  });
});
