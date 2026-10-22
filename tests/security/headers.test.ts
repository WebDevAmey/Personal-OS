// @vitest-environment node
// SEC-B-018: security headers and CSP from next.config.ts.
import { describe, it, expect } from 'vitest';
import nextConfig from '@/next.config';
import { contentSecurityPolicy, securityHeaders } from '@/lib/security/headers';

function asMap(headers: { key: string; value: string }[]) {
  return Object.fromEntries(headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe('security headers (SEC-B-018)', () => {
  it('next.config applies the security headers to every path and no-store to /api', async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === '/:path*');
    expect(all).toBeDefined();
    const h = asMap(all!.headers);
    for (const name of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) {
      expect(h[name], name).toBeTruthy();
    }
    const api = rules.find((r) => r.source === '/api/:path*');
    expect(asMap(api!.headers)['cache-control']).toBe('private, no-store');
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('sets anti-framing, nosniff, referrer and permissions policies', () => {
    const h = asMap(securityHeaders(true));
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('microphone=(self)');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['permissions-policy']).toContain('geolocation=()');
  });

  it('sends HSTS only in production', () => {
    expect(asMap(securityHeaders(true))['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(asMap(securityHeaders(false))['strict-transport-security']).toBeUndefined();
  });

  it('CSP forbids framing, plugins, base hijacking and third-party scripts', () => {
    const csp = contentSecurityPolicy(true);
    const directives = Object.fromEntries(
      csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]),
    );
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['base-uri']).toEqual(["'self'"]);
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['connect-src']).toEqual(["'self'"]);
    expect(directives['script-src']).not.toContain("'unsafe-eval'");
    expect(directives['script-src'].filter((s: string) => s.startsWith('http'))).toEqual([]);
    expect(directives['upgrade-insecure-requests']).toEqual([]);
  });

  it('allows unsafe-eval and HMR websockets only in development', () => {
    const dev = contentSecurityPolicy(false);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toMatch(/connect-src 'self' ws: wss:/);
    expect(dev).not.toContain('upgrade-insecure-requests');
  });
});
