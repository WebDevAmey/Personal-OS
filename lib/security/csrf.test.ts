// @vitest-environment node
// SEC-B-010: Origin / Sec-Fetch-Site check and JSON requirement.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertSameOrigin, checkSameOrigin, csrfGuard, isJsonRequest } from './csrf';

function req(method: string, headers: Record<string, string> = {}, url = 'http://localhost:3000/api/x') {
  return new Request(url, { method, headers });
}

afterEach(() => vi.unstubAllEnvs());

describe('checkSameOrigin', () => {
  it('lets safe methods through without any header', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(checkSameOrigin(req(m)).ok).toBe(true);
  });

  it('accepts a POST whose Origin equals NEXT_PUBLIC_APP_URL', () => {
    expect(checkSameOrigin(req('POST', { origin: 'http://localhost:3000' }))).toEqual({ ok: true });
  });

  it('rejects a cross-site Origin', () => {
    expect(checkSameOrigin(req('POST', { origin: 'https://evil.example' }))).toEqual({ ok: false, reason: 'cross_origin' });
  });

  it('rejects a look-alike origin (prefix / port / scheme)', () => {
    for (const origin of ['http://localhost:3000.evil.example', 'http://localhost:3001', 'https://localhost:3000']) {
      expect(checkSameOrigin(req('POST', { origin })).ok).toBe(false);
    }
  });

  it('rejects Origin: null (sandboxed iframe, data: URL)', () => {
    expect(checkSameOrigin(req('POST', { origin: 'null' }))).toEqual({ ok: false, reason: 'null_origin' });
  });

  it('falls back to Sec-Fetch-Site when Origin is absent', () => {
    expect(checkSameOrigin(req('POST', { 'sec-fetch-site': 'same-origin' })).ok).toBe(true);
    expect(checkSameOrigin(req('POST', { 'sec-fetch-site': 'cross-site' }))).toEqual({ ok: false, reason: 'cross_site_fetch' });
    expect(checkSameOrigin(req('POST', { 'sec-fetch-site': 'same-site' })).ok).toBe(false);
  });

  it('rejects a state-changing request with neither header', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(checkSameOrigin(req(m))).toEqual({ ok: false, reason: 'missing_origin' });
    }
  });

  it('in production trusts only the configured origin, not the request host', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example');
    const internal = req('POST', { origin: 'http://internal:3000' }, 'http://internal:3000/api/x');
    expect(checkSameOrigin(internal).ok).toBe(false);
    expect(checkSameOrigin(req('POST', { origin: 'https://app.example' }, 'http://internal:3000/api/x')).ok).toBe(true);
  });
});

describe('isJsonRequest / csrfGuard', () => {
  it('recognises application/json with parameters', () => {
    expect(isJsonRequest(req('POST', { 'content-type': 'application/json; charset=utf-8' }))).toBe(true);
    expect(isJsonRequest(req('POST', { 'content-type': 'text/plain' }))).toBe(false);
    expect(isJsonRequest(req('POST'))).toBe(false);
  });

  it('blocks the text/plain form-post login CSRF vector with 415', async () => {
    const res = csrfGuard(req('POST', { origin: 'http://localhost:3000', 'content-type': 'text/plain' }));
    expect(res?.status).toBe(415);
  });

  it('returns 403 for a cross-origin JSON post and null for a same-origin one', async () => {
    const blocked = csrfGuard(req('POST', { origin: 'https://evil.example', 'content-type': 'application/json' }));
    expect(blocked?.status).toBe(403);
    expect(await blocked?.json()).toMatchObject({ code: 'CSRF_BLOCKED' });
    expect(csrfGuard(req('POST', { origin: 'http://localhost:3000', 'content-type': 'application/json' }))).toBeNull();
  });

  it('assertSameOrigin does not require a JSON body', () => {
    expect(assertSameOrigin(req('POST', { origin: 'http://localhost:3000' }))).toBeNull();
  });
});
