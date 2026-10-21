import { describe, it, expect } from 'vitest';
import { describeRRule, nextOccurrence, normalizeRRule, parseRRule, pinWallTime, upcomingOccurrences } from './recurrence';
import { floatingDate, parseZoned } from '@/lib/time';

const NY = 'America/New_York';
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('parseRRule', () => {
  it('accepts the supported subset and canonicalises it', () => {
    expect(normalizeRRule('RRULE:freq=weekly;byday=MO,WE;interval=2')).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    expect(parseRRule('FREQ=MONTHLY;BYDAY=-1FR').byDay).toEqual([{ weekday: 5, ordinal: -1 }]);
    expect(parseRRule('FREQ=MONTHLY;BYMONTHDAY=15,-1').byMonthDay).toEqual([15, -1]);
  });

  it.each([
    ['FREQ=HOURLY', /Unsupported FREQ/],
    ['FREQ=DAILY;COUNT=3', /Unsupported rule part COUNT/],
    ['FREQ=WEEKLY;BYDAY=1MO', /ordinals/],
    ['INTERVAL=2', /FREQ is required/],
    ['FREQ=DAILY;INTERVAL=0', /INTERVAL/],
    ['FREQ=DAILY;BYSETPOS=1', /Unsupported/],
  ])('rejects %s with a clear message', (rule, message) => {
    expect(() => parseRRule(rule)).toThrow(message);
  });

  it('describes rules in plain English', () => {
    expect(describeRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Every weekday');
    expect(describeRRule('FREQ=MONTHLY;BYDAY=-1FR')).toBe('Monthly on the last Friday');
    expect(describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU')).toBe('Every 2 weeks on Tuesday');
  });
});

describe('nextOccurrence', () => {
  const longAgo = { now: new Date('2000-01-01T00:00:00Z') };

  it('keeps a daily 09:00 task at 09:00 local across spring-forward (2026-03-08)', () => {
    const current = { dueAt: parseZoned('2026-03-07 09:00 America/New_York'), dueHasTime: true, timeZone: NY };
    const next = nextOccurrence('FREQ=DAILY', current, longAgo);
    expect(iso(next)).toBe('2026-03-08T13:00:00.000Z'); // 09:00 EDT
    expect(iso(next)).toBe(parseZoned('2026-03-08 09:00 America/New_York').toISOString());
  });

  it('keeps a daily 09:00 task at 09:00 local across fall-back (2026-11-01)', () => {
    const current = { dueAt: parseZoned('2026-10-31 09:00 America/New_York'), dueHasTime: true, timeZone: NY };
    expect(iso(nextOccurrence('FREQ=DAILY', current, longAgo))).toBe('2026-11-01T14:00:00.000Z'); // 09:00 EST
  });

  it('moves an occurrence in the DST gap forward without drifting the series', () => {
    const rule = pinWallTime('FREQ=DAILY', parseZoned('2026-03-07 02:30 America/New_York'), NY);
    expect(rule).toBe('FREQ=DAILY;BYHOUR=2;BYMINUTE=30');
    const first = { dueAt: parseZoned('2026-03-07 02:30 America/New_York'), dueHasTime: true, timeZone: NY };
    const gap = nextOccurrence(rule, first, longAgo)!;
    expect(gap.toISOString()).toBe('2026-03-08T07:30:00.000Z'); // 03:30 EDT (02:30 does not exist)
    const after = nextOccurrence(rule, { ...first, dueAt: gap }, longAgo);
    expect(iso(after)).toBe(parseZoned('2026-03-09 02:30 America/New_York').toISOString());
  });

  it('resolves the ambiguous fall-back hour to the first (EDT) instance', () => {
    const rule = 'FREQ=DAILY;BYHOUR=1;BYMINUTE=30';
    const current = { dueAt: parseZoned('2026-10-31 01:30 America/New_York'), dueHasTime: true, timeZone: NY };
    expect(iso(nextOccurrence(rule, current, longAgo))).toBe('2026-11-01T05:30:00.000Z');
  });

  it('rolls missed occurrences forward to the next future date (timed)', () => {
    const current = { dueAt: parseZoned('2026-10-12 09:00 America/New_York'), dueHasTime: true, timeZone: NY };
    const now = parseZoned('2026-10-21 10:00 America/New_York');
    expect(iso(nextOccurrence('FREQ=DAILY', current, { now }))).toBe(parseZoned('2026-10-22 09:00 America/New_York').toISOString());
    const earlier = parseZoned('2026-10-21 08:00 America/New_York');
    expect(iso(nextOccurrence('FREQ=DAILY', current, { now: earlier }))).toBe(parseZoned('2026-10-21 09:00 America/New_York').toISOString());
  });

  it('rolls date-only occurrences forward to today or later', () => {
    const current = { dueAt: floatingDate('2026-10-05'), dueHasTime: false, timeZone: NY };
    const now = parseZoned('2026-10-21 23:30 America/New_York'); // already the 22nd in UTC
    expect(iso(nextOccurrence('FREQ=WEEKLY', current, { now }))).toBe('2026-10-26T00:00:00.000Z');
    expect(iso(nextOccurrence('FREQ=DAILY', current, { now }))).toBe('2026-10-21T00:00:00.000Z');
  });

  it('follows weekly BYDAY with INTERVAL anchored on the series week', () => {
    // Wed 2026-10-21, every 2 weeks on Mon + Wed
    const current = { dueAt: floatingDate('2026-10-21'), dueHasTime: false, timeZone: NY };
    const dates = upcomingOccurrences('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', current, 3).map((d) => d.toISOString().slice(0, 10));
    expect(dates).toEqual(['2026-11-02', '2026-11-04', '2026-11-16']);
  });

  it('supports monthly ordinals, month-day and skipping short months', () => {
    const lastFri = { dueAt: floatingDate('2026-10-30'), dueHasTime: false, timeZone: NY };
    expect(upcomingOccurrences('FREQ=MONTHLY;BYDAY=-1FR', lastFri, 2).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-11-27',
      '2026-12-25',
    ]);
    const on31 = { dueAt: floatingDate('2026-01-31'), dueHasTime: false, timeZone: NY };
    expect(upcomingOccurrences('FREQ=MONTHLY', on31, 2).map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-03-31', '2026-05-31']);
    expect(upcomingOccurrences('FREQ=MONTHLY;BYMONTHDAY=-1', on31, 2).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('supports weekdays via DAILY;BYDAY and stops at UNTIL', () => {
    const fri = { dueAt: floatingDate('2026-10-23'), dueHasTime: false, timeZone: NY };
    expect(iso(nextOccurrence('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', fri, longAgo))).toBe('2026-10-26T00:00:00.000Z');
    expect(nextOccurrence('FREQ=DAILY;UNTIL=20261023', fri, longAgo)).toBeNull();
  });
});
