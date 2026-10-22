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
});
