// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addDays, isValidTimeZone, localDateRangeToUtc, startOfLocalDayUtc, zoneOffsetMs } from './time-zone';

describe('startOfLocalDayUtc', () => {
  it.each([
    ['UTC', '2026-10-21', '2026-10-21T00:00:00.000Z'],
    ['Asia/Kolkata', '2026-10-21', '2026-10-20T18:30:00.000Z'],
    ['America/Los_Angeles', '2026-07-01', '2026-07-01T07:00:00.000Z'],
    ['America/Los_Angeles', '2026-12-01', '2026-12-01T08:00:00.000Z'],
    ['Asia/Kathmandu', '2026-01-01', '2025-12-31T18:15:00.000Z'],
    ['Pacific/Kiritimati', '2026-01-01', '2025-12-31T10:00:00.000Z'],
  ])('%s %s -> %s', (tz, date, expected) => {
    expect(startOfLocalDayUtc(date, tz).toISOString()).toBe(expected);
  });

  it('handles a zone whose clocks spring forward at midnight (day starts at 01:00)', () => {
    // America/Santiago: 2026-09-06 00:00 -04 jumps to 01:00 -03.
    const start = startOfLocalDayUtc('2026-09-06', 'America/Santiago');
    expect(start.toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('rejects invalid dates', () => {
    expect(() => startOfLocalDayUtc('2026-02-30', 'UTC')).toThrow(RangeError);
    expect(() => startOfLocalDayUtc('21/10/2026', 'UTC')).toThrow(RangeError);
  });
});

describe('localDateRangeToUtc', () => {
  it('covers whole local days, end inclusive', () => {
    const { timeMin, timeMax } = localDateRangeToUtc('2026-10-21', '2026-10-21', 'Asia/Kolkata');
    expect(timeMin.toISOString()).toBe('2026-10-20T18:30:00.000Z');
    expect(timeMax.toISOString()).toBe('2026-10-21T18:30:00.000Z');
  });

  it('produces a 25-hour day across the US DST fall-back', () => {
    const { timeMin, timeMax } = localDateRangeToUtc('2026-11-01', '2026-11-01', 'America/New_York');
    expect(timeMin.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(timeMax.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('produces a 23-hour day across the EU DST spring-forward', () => {
    const { timeMin, timeMax } = localDateRangeToUtc('2026-03-29', '2026-03-29', 'Europe/Berlin');
    expect(timeMax.getTime() - timeMin.getTime()).toBe(23 * 3600 * 1000);
  });
});

describe('helpers', () => {
  it('validates time zones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('computes offsets and adds days across month/year boundaries', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 1), 'Asia/Kolkata')).toBe(5.5 * 3600 * 1000);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
