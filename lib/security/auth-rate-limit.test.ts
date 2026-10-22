// @vitest-environment node
// ADR-012 limiter against the real test database.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { checkAuthRateLimit, emailHash, hitRateLimit, rateLimitedResponse } from './auth-rate-limit';

const key = () => `test:${randomUUID()}`;

describe('hitRateLimit', () => {
  it('allows up to the limit and denies the next hit with a Retry-After', async () => {
    const k = key();
    const rule = { limit: 3, windowMs: 60_000 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit(k, rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].count).toBe(4);
    expect(results[3].retryAfterSeconds).toBeGreaterThan(0);
    expect(results[3].retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('is atomic: 25 concurrent hits produce exactly `limit` allowed results', async () => {
    const k = key();
    const rule = { limit: 5, windowMs: 60_000 };
    const results = await Promise.all(Array.from({ length: 25 }, () => hitRateLimit(k, rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const row = await prisma.rateLimitAttempt.findUnique({ where: { key: k } });
    expect(row?.count).toBe(25);
  });

  it('starts a fresh window once the stored window has elapsed', async () => {
    const k = key();
    await prisma.rateLimitAttempt.create({
      data: { key: k, count: 99, windowStart: new Date(Date.now() - 120_000) },
    });
    const result = await hitRateLimit(k, { limit: 2, windowMs: 60_000 });
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
  });

  it('keeps counting within an unexpired window written by another process', async () => {
    const k = key();
    await prisma.rateLimitAttempt.create({ data: { key: k, count: 2, windowStart: new Date(Date.now() - 10_000) } });
    const result = await hitRateLimit(k, { limit: 2, windowMs: 60_000 });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(40);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(50);
  });
});

describe('checkAuthRateLimit', () => {
  it('keys the email dimension by an HMAC, never the address', async () => {
    const email = `limit-${randomUUID()}@example.test`;
    await checkAuthRateLimit('login', { email });
    const rows = await prisma.rateLimitAttempt.findMany({ where: { key: { contains: emailHash(email) } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(`login:email:${emailHash(email)}`);
    expect(rows[0].key).not.toContain(email);
  });

  it('normalises the email before hashing', () => {
    expect(emailHash('  A@Example.TEST ')).toBe(emailHash('a@example.test'));
  });

  it('denies on the email dimension even when each request comes from a new IP', async () => {
    const email = `limit-${randomUUID()}@example.test`;
    const decisions = [];
    for (let i = 0; i < 11; i++) {
      decisions.push(await checkAuthRateLimit('login', { email, ip: `192.0.2.${i}-${randomUUID()}` }));
    }
    expect(decisions.slice(0, 10).every((d) => d.allowed)).toBe(true);
    expect(decisions[10]).toMatchObject({ allowed: false, scope: 'email' });
  });
});

describe('rateLimitedResponse', () => {
  it('is a 429 with Retry-After', async () => {
    const res = rateLimitedResponse(42);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });
});
