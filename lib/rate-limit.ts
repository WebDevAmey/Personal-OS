// lib/rate-limit.ts — per-user limits for AI commands and integration calls
// (ADR-012, docs/04 §5, SEC-B-016).
//
// - Upstash sliding window when UPSTASH_REDIS_REST_URL/TOKEN are set.
// - In-memory sliding window when they are absent (dev/test, single process).
// - Fail closed: an Upstash error denies the request, and in production a
//   limiter answer that only succeeded because Upstash timed out
//   (`reason: 'timeout'`) is treated as a deny too.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/observability/logger';

export type RateLimitBucket = 'ai' | 'integration';

export const BUCKETS: Record<RateLimitBucket, { limit: number; windowMs: number }> = {
  ai: { limit: 30, windowMs: 60_000 },
  integration: { limit: 60, windowMs: 60_000 },
};

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

// ───────────────────────── in-memory fallback ─────────────────────────

const memory = new Map<string, number[]>();

function memoryLimit(bucket: RateLimitBucket, key: string, now: number): RateLimitResult {
  const { limit, windowMs } = BUCKETS[bucket];
  const id = `${bucket}:${key}`;
  const hits = (memory.get(id) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) {
    memory.set(id, hits);
    return { allowed: false, retryAfterMs: Math.max(0, hits[0] + windowMs - now) };
  }
  hits.push(now);
  memory.set(id, hits);
  return { allowed: true };
}

/** Test seam: clears the in-memory windows. */
export function resetMemoryRateLimits(): void {
  memory.clear();
}

// ───────────────────────── Upstash ─────────────────────────

let limiters: Record<RateLimitBucket, Ratelimit> | null = null;

function upstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function upstash(): Record<RateLimitBucket, Ratelimit> {
  if (!limiters) {
    const redis = Redis.fromEnv();
    const make = (bucket: RateLimitBucket) =>
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(BUCKETS[bucket].limit, `${BUCKETS[bucket].windowMs / 1000} s`),
        prefix: `ratelimit:${bucket}`,
        timeout: 1000,
      });
    limiters = { ai: make('ai'), integration: make('integration') };
  }
  return limiters;
}

/** Test seam: forget constructed Upstash clients (env changes between tests). */
export function resetRateLimiters(): void {
  limiters = null;
}

export async function checkRateLimit(userId: string, bucket: RateLimitBucket, now = Date.now()): Promise<RateLimitResult> {
  if (!upstashConfigured()) return memoryLimit(bucket, userId, now);
  try {
    const res = await upstash()[bucket].limit(userId);
    if (res.success && res.reason === 'timeout' && process.env.NODE_ENV === 'production') {
      logger.warn('rate_limit.upstash_timeout', { bucket });
      return { allowed: false, retryAfterMs: 1000 };
    }
    if (!res.success) return { allowed: false, retryAfterMs: Math.max(0, res.reset - now) };
    return { allowed: true };
  } catch (err) {
    logger.error('rate_limit.upstash_failed', { bucket, errorName: (err as Error)?.name });
    return { allowed: false, retryAfterMs: 1000 };
  }
}
