import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limitMock = vi.fn();
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    limit = limitMock;
  },
}));
vi.mock('@upstash/redis', () => ({ Redis: class { static fromEnv() { return {}; } } }));

import { BUCKETS, checkRateLimit, resetMemoryRateLimits, resetRateLimiters } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetMemoryRateLimits();
    resetRateLimiters();
    limitMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('in-memory fallback (no Upstash env)', () => {
    it('allows up to the bucket limit, then denies with retryAfterMs', async () => {
      const t = 1_000_000;
      for (let i = 0; i < BUCKETS.ai.limit; i++) expect((await checkRateLimit('u1', 'ai', t + i)).allowed).toBe(true);
      const denied = await checkRateLimit('u1', 'ai', t + 100);
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(limitMock).not.toHaveBeenCalled();
    });

    it('keeps users and buckets separate and frees the window after it slides', async () => {
      const t = 2_000_000;
      for (let i = 0; i < BUCKETS.ai.limit; i++) await checkRateLimit('u2', 'ai', t);
      expect((await checkRateLimit('u3', 'ai', t)).allowed).toBe(true);
      expect((await checkRateLimit('u2', 'integration', t)).allowed).toBe(true);
      expect((await checkRateLimit('u2', 'ai', t + BUCKETS.ai.windowMs + 1)).allowed).toBe(true);
    });
  });

  describe('Upstash', () => {
    beforeEach(() => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.test');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    });

    it('allows when Upstash says success', async () => {
      limitMock.mockResolvedValue({ success: true, reset: 0 });
      expect(await checkRateLimit('u1', 'ai')).toEqual({ allowed: true });
    });

    it('denies when Upstash says no', async () => {
      limitMock.mockResolvedValue({ success: false, reset: Date.now() + 5000 });
      const r = await checkRateLimit('u1', 'ai');
      expect(r.allowed).toBe(false);
    });

    it('fails closed when Upstash throws', async () => {
      limitMock.mockRejectedValue(new Error('ECONNRESET'));
      expect((await checkRateLimit('u1', 'ai')).allowed).toBe(false);
    });

    it('treats a timeout-success as a deny in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      limitMock.mockResolvedValue({ success: true, reason: 'timeout', reset: 0 });
      expect((await checkRateLimit('u1', 'ai')).allowed).toBe(false);
    });
  });
});
