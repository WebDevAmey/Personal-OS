// lib/rate-limit.ts — per-user limits for AI commands and integration calls
// (ADR-012, docs/04 §5, SEC-B-016).
//
// - Upstash sliding window when UPSTASH_REDIS_REST_URL/TOKEN are set.
// - In-memory sliding window when they are absent, in dev/test only (single
//   process; a warning is logged once). In production a missing Upstash
//   config fails closed: every request is denied and `ratelimit.fallback` is
//   logged once, unless RATE_LIMIT_ALLOW_MEMORY=1 opts in explicitly
//   (SEC-R-003). On a serverless platform each instance has its own map, so
//   the memory limiter is not a real limit there.
// - `command_daily` is a per-user daily command budget (COMMAND_DAILY_LIMIT,
//   default 300) that caps model spend behind the per-minute window.
// - Fail closed: an Upstash error denies the request, and in production a
//   limiter answer that only succeeded because Upstash timed out
//   (`reason: 'timeout'`) is treated as a deny too.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/observability/logger';

export type RateLimitBucket = 'ai' | 'integration' | 'command_daily';

export const DEFAULT_COMMAND_DAILY_LIMIT = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

export const BUCKETS: Record<RateLimitBucket, { limit: number; windowMs: number }> = {
  ai: { limit: 30, windowMs: 60_000 },
  integration: { limit: 60, windowMs: 60_000 },
  command_daily: { limit: DEFAULT_COMMAND_DAILY_LIMIT, windowMs: DAY_MS },
};

/** The daily command budget, overridable with COMMAND_DAILY_LIMIT (a positive integer). */
export function commandDailyLimit(): number {
  const raw = process.env.COMMAND_DAILY_LIMIT;
  if (!raw) return DEFAULT_COMMAND_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_COMMAND_DAILY_LIMIT;
}

export function bucketConfig(bucket: RateLimitBucket): { limit: number; windowMs: number } {
  return bucket === 'command_daily' ? { ...BUCKETS.command_daily, limit: commandDailyLimit() } : BUCKETS[bucket];
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

// ───────────────────────── in-memory fallback ─────────────────────────

const memory = new Map<string, number[]>();

function memoryLimit(bucket: RateLimitBucket, key: string, now: number): RateLimitResult {
  const { limit, windowMs } = bucketConfig(bucket);
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

let limiters: Map<string, Ratelimit> | null = null;

function upstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function upstash(bucket: RateLimitBucket): Ratelimit {
  limiters ??= new Map();
  const { limit, windowMs } = bucketConfig(bucket);
  const key = `${bucket}:${limit}:${windowMs}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(limit, `${windowMs / 1000} s`),
      prefix: `ratelimit:${bucket}`,
      timeout: 1000,
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

/** Test seam: forget constructed Upstash clients (env changes between tests). */
export function resetRateLimiters(): void {
  limiters = null;
  loggedDeny = false;
  warnedMemory = false;
}

// ───────────────────────── fallback policy ─────────────────────────

let loggedDeny = false;
let warnedMemory = false;

/** True only when the operator opted in to the per-instance limiter in production. */
function memoryAllowedInProduction(): boolean {
  return process.env.RATE_LIMIT_ALLOW_MEMORY === '1';
}

function fallback(bucket: RateLimitBucket, userId: string, now: number): RateLimitResult {
  const production = process.env.NODE_ENV === 'production';
  if (production && !memoryAllowedInProduction()) {
    if (!loggedDeny) {
      loggedDeny = true;
      logger.error('ratelimit.fallback', { bucket, action: 'deny', reason: 'upstash_not_configured' });
    }
    return { allowed: false, retryAfterMs: 60_000 };
  }
  if (!warnedMemory) {
    warnedMemory = true;
    logger.warn('ratelimit.fallback', { bucket, action: 'memory', production });
  }
  return memoryLimit(bucket, userId, now);
}

export async function checkRateLimit(userId: string, bucket: RateLimitBucket, now = Date.now()): Promise<RateLimitResult> {
  if (!upstashConfigured()) return fallback(bucket, userId, now);
  try {
    const res = await upstash(bucket).limit(userId);
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
