// SEC-R-003 proof of concept (independent review, 2026-10-22).
//
// ADR-012 and docs/10 §env say the in-memory limiter is a dev/test fallback
// only, and that the fallback being active in production must never happen
// (alert `ratelimit.fallback`). lib/rate-limit.ts:76 uses the in-memory map
// whenever the Upstash env vars are missing, in every environment and
// without logging. On Vercel each serverless instance has its own map, so a
// production deploy with a missing/misnamed Upstash variable silently gives
// every user a per-instance window: 30 commands/min x N instances, with no
// daily token budget behind it (SEC-B-016).
//
// This test describes the required behaviour and FAILS against the current code.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, resetMemoryRateLimits, resetRateLimiters } from '@/lib/rate-limit';

afterEach(() => {
  vi.unstubAllEnvs();
  resetMemoryRateLimits();
  resetRateLimiters();
});

describe('SEC-R-003: production must not silently fall back to the per-instance limiter', () => {
  it('denies AI commands in production when Upstash is not configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const r = await checkRateLimit('user-prod-fallback', 'ai');
    expect(r.allowed).toBe(false);
  });
});
