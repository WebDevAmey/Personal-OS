import { describe, it, expect } from 'vitest';
import { readCookie } from './cookies';

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
    const req = new Request('http://localhost/');
    expect(readCookie(req, 'google_oauth_state')).toBeNull();
  });
});
