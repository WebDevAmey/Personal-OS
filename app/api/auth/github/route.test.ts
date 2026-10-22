// @vitest-environment node
// GET /api/auth/github: state + PKCE (S256) cookies and redirect.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { GET } from './route';

const start = () => GET(new Request('http://localhost:3000/api/auth/github', { headers: { 'x-real-ip': `10.8.${Math.random()}` } }));

describe('GET /api/auth/github', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('redirects to GitHub with state and an S256 code challenge matching the PKCE cookie', async () => {
    const res = await start();
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.hostname).toBe('github.com');
    const cookies = res.headers.getSetCookie();
    const state = cookies.find((c) => c.startsWith('github_oauth_state='))!;
    const pkce = cookies.find((c) => c.startsWith('github_oauth_pkce='))!;
    for (const c of [state, pkce]) {
      expect(c).toMatch(/HttpOnly/);
      expect(c).toMatch(/SameSite=Lax/);
      expect(c).toMatch(/Max-Age=300/);
    }
    expect(location.searchParams.get('state')).toBe(state.split(';')[0].split('=')[1]);
    const verifier = decodeURIComponent(pkce.split(';')[0].split('=')[1]);
    expect(location.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('marks the flow cookies Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const c of (await start()).headers.getSetCookie()) expect(c).toMatch(/; Secure/);
  });

  it('does not mark the cookies Secure outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    for (const c of (await start()).headers.getSetCookie()) expect(c).not.toMatch(/; Secure/);
  });
});
