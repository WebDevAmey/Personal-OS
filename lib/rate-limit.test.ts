import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limitMock = vi.fn();
const windows: Array<{ limit: number; window: string }> = [];
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow(limit: number, window: string) {
      windows.push({ limit, window });
      return {};
    }
    limit = limitMock;
  },
}));
vi.mock('@upstash/redis', () => ({ Redis: class { static fromEnv() { return {}; } } }));

import { logger } from '@/lib/observability/logger';
import { BUCKETS, DEFAULT_COMMAND_DAILY_LIMIT, checkRateLimit, commandDailyLimit, resetMemoryRateLimits, resetRateLimiters } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetMemoryRateLimits();
    resetRateLimiters();
    limitMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('fallback policy (SEC-R-003)', () => {
    const noUpstash = () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    };

    it('fails closed in production without Upstash and logs ratelimit.fallback once', async () => {
      noUpstash();
      vi.stubEnv('NODE_ENV', 'production');
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      for (const bucket of ['ai', 'integration', 'command_daily'] as const) {
        const r = await checkRateLimit('u-prod', bucket);
        expect(r.allowed).toBe(false);
        expect(r.retryAfterMs).toBeGreaterThan(0);
      }
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toBe('ratelimit.fallback');
    });

    it('uses the memory limiter in production only with RATE_LIMIT_ALLOW_MEMORY=1, and warns', async () => {
      noUpstash();
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('RATE_LIMIT_ALLOW_MEMORY', '1');
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      expect((await checkRateLimit('u-optin', 'ai')).allowed).toBe(true);
      expect(warn).toHaveBeenCalledWith('ratelimit.fallback', expect.objectContaining({ action: 'memory', production: true }));
    });

    it('ignores other values of RATE_LIMIT_ALLOW_MEMORY', async () => {
      noUpstash();
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('RATE_LIMIT_ALLOW_MEMORY', 'true');
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      expect((await checkRateLimit('u-optin2', 'ai')).allowed).toBe(false);
    });

    it('warns once when the memory fallback is used outside production', async () => {
      noUpstash();
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      await checkRateLimit('u-dev', 'ai');
      await checkRateLimit('u-dev', 'integration');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('ratelimit.fallback', expect.objectContaining({ action: 'memory', production: false }));
    });
  });

  describe('daily command budget', () => {
    it('defaults to 300 a day and reads COMMAND_DAILY_LIMIT', () => {
      expect(commandDailyLimit()).toBe(DEFAULT_COMMAND_DAILY_LIMIT);
      expect(DEFAULT_COMMAND_DAILY_LIMIT).toBe(300);
      vi.stubEnv('COMMAND_DAILY_LIMIT', '5');
      expect(commandDailyLimit()).toBe(5);
      for (const bad of ['0', '-1', 'abc', '2.5']) {
        vi.stubEnv('COMMAND_DAILY_LIMIT', bad);
        expect(commandDailyLimit()).toBe(DEFAULT_COMMAND_DAILY_LIMIT);
      }
    });

    it('denies after the daily limit until the day-long window slides', async () => {
      vi.stubEnv('COMMAND_DAILY_LIMIT', '3');
      const t = 5_000_000;
      for (let i = 0; i < 3; i++) expect((await checkRateLimit('u-day', 'command_daily', t + i * 3_600_000)).allowed).toBe(true);
      const denied = await checkRateLimit('u-day', 'command_daily', t + 4 * 3_600_000);
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterMs).toBe(20 * 3_600_000);
      expect((await checkRateLimit('u-day', 'command_daily', t + BUCKETS.command_daily.windowMs + 1)).allowed).toBe(true);
    });

    it('builds the Upstash limiter with the configured daily limit', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.test');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
      vi.stubEnv('COMMAND_DAILY_LIMIT', '7');
      windows.length = 0;
      limitMock.mockResolvedValue({ success: true, reset: 0 });
      await checkRateLimit('u1', 'command_daily');
      expect(windows).toEqual([{ limit: 7, window: '86400 s' }]);
    });
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
