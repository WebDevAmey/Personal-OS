import { describe, it, expect } from 'vitest';
import {
  addDays,
  diffDays,
  floatingDate,
  floatingToLocalDate,
  isLocalDate,
  isValidTimeZone,
  localDateOf,
  localDayRange,
  offsetMs,
  parseZoned,
  weekdayOf,
  zonedTimeToUtc,
} from './index';

const NY = 'America/New_York';

describe('lib/time', () => {
  it('validates IANA time zones', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('+05:00')).toBe(false);
  });

  it('computes zone offsets either side of DST', () => {
    expect(offsetMs(new Date('2026-01-15T12:00:00Z'), NY)).toBe(-5 * 3600_000);
    expect(offsetMs(new Date('2026-07-15T12:00:00Z'), NY)).toBe(-4 * 3600_000);
    expect(offsetMs(new Date('2026-07-15T12:00:00Z'), 'Asia/Kolkata')).toBe(5.5 * 3600_000);
  });

  it('converts wall time to UTC across spring-forward (2026-03-08)', () => {
    expect(parseZoned('2026-03-07 09:00 America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(parseZoned('2026-03-08 09:00 America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
    // 02:30 does not exist that day: moves forward to 03:30 EDT.
    expect(parseZoned('2026-03-08 02:30 America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('converts wall time to UTC across fall-back (2026-11-01), earlier by default', () => {
    expect(parseZoned('2026-11-01 01:30 America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(
      zonedTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY, 'later').toISOString(),
    ).toBe('2026-11-01T06:30:00.000Z');
    expect(parseZoned('2026-11-01 09:00 America/New_York').toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('gives 23- and 25-hour local days on DST transitions', () => {
    const spring = localDayRange('2026-03-08', NY);
    expect((spring.end.getTime() - spring.start.getTime()) / 3600_000).toBe(23);
    const fall = localDayRange('2026-11-01', NY);
    expect((fall.end.getTime() - fall.start.getTime()) / 3600_000).toBe(25);
  });

  it('derives the local calendar date of an instant', () => {
    const lateEvening = new Date('2026-10-22T02:30:00Z'); // 22:30 on the 21st in NY
    expect(localDateOf(lateEvening, NY)).toBe('2026-10-21');
    expect(localDateOf(lateEvening, 'Asia/Kolkata')).toBe('2026-10-22');
  });

  it('does pure calendar arithmetic on local dates', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-10-21', '2026-11-02')).toBe(12);
    expect(weekdayOf('2026-10-21')).toBe(3); // Wednesday
    expect(isLocalDate('2026-02-30')).toBe(false);
  });

  it('round-trips floating dates without shifting them', () => {
    const d = floatingDate('2026-10-22');
    expect(d.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(floatingToLocalDate(d)).toBe('2026-10-22');
  });
});
