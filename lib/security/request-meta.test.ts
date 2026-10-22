// Client IP extraction and its proxy trust rules (SEC-R-013).
import { describe, expect, it } from 'vitest';
import { clientIp, trustsClientIpHeaders } from './request-meta';

const req = (headers: Record<string, string>) => new Request('https://app.test/api/auth/login', { headers });
const spoofed = { 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '7.7.7.7, 10.0.0.1, 198.51.100.4' };

describe('clientIp', () => {
  it('trusts x-real-ip on Vercel', () => {
    expect(clientIp(req(spoofed), { NODE_ENV: 'production', VERCEL: '1' })).toBe('6.6.6.6');
  });

  it('trusts the headers when the operator declares a proxy', () => {
    expect(clientIp(req(spoofed), { NODE_ENV: 'production', TRUST_PROXY_IP_HEADERS: '1' })).toBe('6.6.6.6');
  });

  it('uses only the rightmost forwarded entry on an undeclared production host', () => {
    const env = { NODE_ENV: 'production' };
    expect(trustsClientIpHeaders(env)).toBe(false);
    expect(clientIp(req(spoofed), env)).toBe('198.51.100.4');
    expect(clientIp(req({ 'x-real-ip': '6.6.6.6' }), env)).toBe('unknown');
  });

  it('keeps the simple rule in dev and test', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), { NODE_ENV: 'test' })).toBe('203.0.113.7');
    expect(clientIp(req({}), { NODE_ENV: 'development' })).toBe('unknown');
  });
});
