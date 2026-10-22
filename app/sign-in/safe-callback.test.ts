// SEC-B-011: open redirect via callbackUrl.
import { describe, it, expect } from 'vitest';
import { safeCallback } from '@/lib/auth/safe-callback';

describe('safeCallback (SEC-B-011)', () => {
  it.each([
    ['/today', '/today'],
    ['/tasks?view=upcoming#top', '/tasks?view=upcoming#top'],
    ['/projects/abc', '/projects/abc'],
  ])('keeps same-origin path %s', (input, expected) => {
    expect(safeCallback(input)).toBe(expected);
  });

  it.each([
    'https://evil.example',
    'http://evil.example/today',
    '//evil.example',
    '//evil.example/today',
    '/\\evil.example',
    '\\\\evil.example',
    '/\t/evil.example',
    '/ /evil.example',
    'javascript:alert(1)',
    'today',
    '',
    '/sign-in',
    '/sign-up?x=1',
    `/${'a'.repeat(600)}`,
  ])('rejects %j and falls back to /today', (input) => {
    expect(safeCallback(input)).toBe('/today');
  });

  it('falls back on null/undefined', () => {
    expect(safeCallback(null)).toBe('/today');
    expect(safeCallback(undefined)).toBe('/today');
  });

  it('normalises dot segments without leaving the origin', () => {
    expect(safeCallback('/a/../today')).toBe('/today');
  });

  // SEC-R-002: the normalised value is validated, not only the raw string.
  it.each([
    '/.//evil.example',
    '/a/..//evil.example',
    '/%2e//evil.example',
    '/%2E%2E//evil.example',
    '/./%2e//evil.example/path?x=1',
    '/%2f/evil.example',
    '/%5cevil.example',
    '/%252f%252fevil.example',
    '/today\u0000',
    '/to day',
  ])('rejects %j after normalisation', (input) => {
    const out = safeCallback(input);
    expect(out).toBe('/today');
  });

  it('returns only paths that resolve to the app origin', () => {
    for (const input of ['/a/./b', '/x/../y?z=1#h', '/tasks?next=%2Ftoday']) {
      const out = safeCallback(input);
      expect(out.startsWith('//')).toBe(false);
      expect(new URL(out, 'https://app.example').origin).toBe('https://app.example');
    }
    expect(safeCallback('/tasks?next=%2Ftoday')).toBe('/tasks?next=%2Ftoday');
  });
});
