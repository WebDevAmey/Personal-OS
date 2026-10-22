// @vitest-environment node
// GET /api/auth/google: state + PKCE (S256) cookies and redirect.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { GET } from './route';

const start = () => GET(new Request('http://localhost:3000/api/auth/google', { headers: { 'x-real-ip': `10.9.${Math.random()}` } }));

describe('GET /api/auth/google', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('redirects to Google with state and an S256 code challenge matching the PKCE cookie', async () => {
    const res = await start();
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');

    const cookies = res.headers.getSetCookie();
    const state = cookies.find((c) => c.startsWith('google_oauth_state='))!;
    const pkce = cookies.find((c) => c.startsWith('google_oauth_pkce='))!;
    for (const c of [state, pkce]) {
      expect(c).toMatch(/HttpOnly/);
      expect(c).toMatch(/SameSite=Lax/);
      expect(c).toMatch(/Max-Age=300/);
      expect(c).toMatch(/Path=\//);
    }
    expect(location.searchParams.get('state')).toBe(state.split(';')[0].split('=')[1]);
    const verifier = decodeURIComponent(pkce.split(';')[0].split('=')[1]);
    expect(verifier).toMatch(/^[\w-]{43,128}$/);
    expect(location.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('marks the flow cookies Secure with the __Host- prefix in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const cookies = (await start()).headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const c of cookies) {
      expect(c).toMatch(/^__Host-google_oauth_(state|pkce)=/);
      expect(c).toMatch(/; Secure/);
    }
  });

  it('does not mark the cookies Secure outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    for (const c of (await start()).headers.getSetCookie()) expect(c).not.toMatch(/; Secure/);
  });
});
