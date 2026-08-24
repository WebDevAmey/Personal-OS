import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit } from './rate-limit';

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() { return {}; }
    limit = vi.fn().mockResolvedValue({ success: true });
  },
}));
vi.mock('@upstash/redis', () => ({ Redis: class { static fromEnv() { return {}; } } }));

describe('checkRateLimit', () => {
  it('allows a request within the AI bucket limit', async () => {
    const result = await checkRateLimit('user-1', 'ai');
    expect(result.allowed).toBe(true);
  });
});
