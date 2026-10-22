// @vitest-environment node
// Cookie flags (T-SESS-07, T-SESS-08, SEC-B-009).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildSessionCookie, clearSessionCookie, cookieName, readAuthCookie, readCookie, sessionCookieName } from './cookies';

afterEach(() => vi.unstubAllEnvs());

describe('readCookie', () => {
  it('reads a named cookie value from the Cookie header', () => {
    const req = new Request('http://localhost/', { headers: { cookie: 'foo=bar; google_oauth_state=abc123' } });
    expect(readCookie(req, 'google_oauth_state')).toBe('abc123');
  });

  it('returns null when the cookie is not present', () => {
    const req = new Request('http://localhost/', { headers: { cookie: 'foo=bar' } });
    expect(readCookie(req, 'google_oauth_state')).toBeNull();
  });

  it('returns null when there is no Cookie header at all', () => {
    expect(readCookie(new Request('http://localhost/'), 'google_oauth_state')).toBeNull();
  });

  it('returns null instead of throwing on a malformed percent-encoding', () => {
    const req = new Request('http://localhost/', { headers: { cookie: 'x=%E0%A4%A' } });
    expect(readCookie(req, 'x')).toBeNull();
  });
});

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax, Path=/, with an explicit 30-day Max-Age, and not Secure in development', () => {
    const cookie = buildSessionCookie('tok');
    expect(cookie).toMatch(/^session=tok;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('uses the __Host- prefix and Secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookieName()).toBe('__Host-session');
    const cookie = buildSessionCookie('tok');
    expect(cookie).toMatch(/^__Host-session=tok;/);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
  });

  it('clears with Max-Age=0 and the same name', () => {
    expect(clearSessionCookie()).toMatch(/^session=; .*Max-Age=0/);
  });

  it('readAuthCookie resolves the environment-specific name', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const req = new Request('http://localhost/', { headers: { cookie: 'pk_chal=wrong; __Host-pk_chal=right' } });
    expect(cookieName('pk_chal')).toBe('__Host-pk_chal');
    expect(readAuthCookie(req, 'pk_chal')).toBe('right');
  });
});
