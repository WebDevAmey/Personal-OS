// app/api/auth/google/route.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from './route';

describe('GET /api/auth/google', () => {
  // vi.stubEnv (rather than assigning process.env.NODE_ENV directly) because
  // @types/node marks NODE_ENV read-only on ProcessEnv.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects to Google with a state cookie that is HttpOnly, SameSite=Lax, and short-lived', async () => {
    const res = await GET();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('accounts.google.com');
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toMatch(/^google_oauth_state=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=300/);
  });

  // Finding 3: this is the one auth-relevant cookie in the codebase that
  // could be missing Secure in production, letting a network attacker
  // capture it over plaintext HTTP and pull off a login-CSRF. It must match
  // the `isProd ? '; Secure' : ''` pattern the session cookie already uses
  // (see app/api/auth/login/route.ts).
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
