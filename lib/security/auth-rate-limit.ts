// lib/security/auth-rate-limit.ts
// ADR-012: fixed-window counters for auth endpoints, stored in Postgres
// (`RateLimitAttempt`). One atomic `INSERT … ON CONFLICT DO UPDATE` per hit,
// so concurrent requests cannot both read "under the limit" and both pass.
// Timestamps are compared as UTC `timestamp(3)` values, which is how Prisma
// stores DateTime columns, so the result does not depend on the session's
// TimeZone setting.
// The limiter fails closed: if the database is unavailable the query throws
// and the route returns 500 rather than letting the attempt through.
import { createHmac } from 'node:crypto';
import { prisma } from '@/lib/prisma';

export interface LimitRule {
  limit: number;
  windowMs: number;
}

export interface HitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/** Limits per route. Keys are `<route>:ip:<ip>` and `<route>:email:<hmac>`. */
export const AUTH_LIMITS = {
  login: { ip: { limit: 20, windowMs: 15 * 60_000 }, email: { limit: 10, windowMs: 15 * 60_000 } },
  signup: { ip: { limit: 10, windowMs: 60 * 60_000 }, email: { limit: 5, windowMs: 60 * 60_000 } },
  'verify-otp': { ip: { limit: 30, windowMs: 15 * 60_000 }, email: { limit: 10, windowMs: 60 * 60_000 } },
  'forgot-password': { ip: { limit: 10, windowMs: 60 * 60_000 } },
  // Issuance caps, counted per email inside the deferred task (SEC-B-002).
  'reset-issue': { email: { limit: 5, windowMs: 24 * 60 * 60_000 } },
  'reset-issue-burst': { email: { limit: 1, windowMs: 60_000 } },
  // Total reset-code guesses per email across all tokens (SEC-B-002).
  'reset-password': { ip: { limit: 20, windowMs: 15 * 60_000 }, email: { limit: 10, windowMs: 24 * 60 * 60_000 } },
  'passkey-options': { ip: { limit: 10, windowMs: 60_000 } },
  // Password re-entry before a credential change (SEC-R-005).
  reauth: { ip: { limit: 10, windowMs: 15 * 60_000 }, email: { limit: 10, windowMs: 15 * 60_000 } },
  'passkey-verify': { ip: { limit: 20, windowMs: 15 * 60_000 } },
  oauth: { ip: { limit: 30, windowMs: 15 * 60_000 } },
} satisfies Record<string, { ip?: LimitRule; email?: LimitRule }>;

export type AuthRoute = keyof typeof AUTH_LIMITS;

function hmacKey(): string {
  const key = process.env.RATE_LIMIT_HMAC_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('RATE_LIMIT_HMAC_KEY or JWT_SECRET must be set');
  return key;
}

/** Keyed hash of a normalised email, so limiter keys never hold the address. */
export function emailHash(email: string): string {
  return createHmac('sha256', hmacKey()).update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * Counts one hit against `key`. Starts a new window when the stored one has
 * elapsed. Returns whether this hit is within the limit.
 */
export async function hitRateLimit(key: string, rule: LimitRule): Promise<HitResult> {
  const windowSeconds = rule.windowMs / 1000;
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimitAttempt" ("key", "count", "windowStart")
    VALUES (${key}, 1, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitAttempt"."windowStart" <= (now() AT TIME ZONE 'UTC') - make_interval(secs => ${windowSeconds}::double precision) THEN 1
        ELSE "RateLimitAttempt"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitAttempt"."windowStart" <= (now() AT TIME ZONE 'UTC') - make_interval(secs => ${windowSeconds}::double precision) THEN (now() AT TIME ZONE 'UTC')
        ELSE "RateLimitAttempt"."windowStart"
      END
    RETURNING "count", "windowStart"
  `;
  const row = rows[0];
  const count = Number(row.count);
  const windowEnds = new Date(row.windowStart).getTime() + rule.windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEnds - Date.now()) / 1000));
  return { allowed: count <= rule.limit, count, limit: rule.limit, retryAfterSeconds };
}

export interface LimitSubject {
  ip?: string | null;
  email?: string | null;
}

export interface LimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  /** Which dimension tripped, for audit metadata. */
  scope?: 'ip' | 'email';
}

/**
 * Applies the configured per-IP and per-email rules for `route`. Both counters
 * are always incremented, so an attacker cannot avoid the email counter by
 * tripping the IP one first.
 */
export async function checkAuthRateLimit(route: AuthRoute, subject: LimitSubject): Promise<LimitDecision> {
  const rules = AUTH_LIMITS[route] as { ip?: LimitRule; email?: LimitRule };
  const results: { scope: 'ip' | 'email'; result: HitResult }[] = [];
  if (rules.ip && subject.ip) {
    results.push({ scope: 'ip', result: await hitRateLimit(`${route}:ip:${subject.ip}`, rules.ip) });
  }
  if (rules.email && subject.email) {
    results.push({ scope: 'email', result: await hitRateLimit(`${route}:email:${emailHash(subject.email)}`, rules.email) });
  }
  const denied = results.filter((r) => !r.result.allowed);
  if (denied.length === 0) return { allowed: true, retryAfterSeconds: 0 };
  const worst = denied.reduce((a, b) => (a.result.retryAfterSeconds >= b.result.retryAfterSeconds ? a : b));
  return { allowed: false, retryAfterSeconds: worst.result.retryAfterSeconds, scope: worst.scope };
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'Too many attempts. Please wait and try again.', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

/** Deletes counters whose window ended more than `olderThanMs` ago (for a sweep job). */
export async function purgeExpiredRateLimits(olderThanMs = 24 * 60 * 60_000): Promise<number> {
  const result = await prisma.rateLimitAttempt.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - olderThanMs) } },
  });
  return result.count;
}
