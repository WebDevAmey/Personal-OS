// app/api/auth/github/route.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from './route';

describe('GET /api/auth/github', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects to GitHub with a state cookie that is HttpOnly, SameSite=Lax, and short-lived', async () => {
    const res = await GET();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('github.com');
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toMatch(/^github_oauth_state=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=300/);
  });

  // Lesson 3: the CSRF state cookie must match the `isProd ? '; Secure' :
  // ''` pattern used by app/api/auth/login/route.ts and (post-fix)
  // app/api/auth/google/route.ts — otherwise it can travel over plaintext
  // HTTP and be captured by a network attacker.
  it('marks the state cookie Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await GET();
    expect(res.headers.get('set-cookie')).toMatch(/; Secure/);
  });

  it('does not mark the state cookie Secure outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const res = await GET();
    expect(res.headers.get('set-cookie')).not.toMatch(/; Secure/);
  });
});
