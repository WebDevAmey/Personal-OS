import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const limiters = {
  ai: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '1 m'), prefix: 'ratelimit:ai' }),
  integration: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, '1 m'), prefix: 'ratelimit:integration' }),
};

export async function checkRateLimit(userId: string, bucket: 'ai' | 'integration'): Promise<{ allowed: boolean }> {
  const { success } = await limiters[bucket].limit(userId);
  return { allowed: success };
}
