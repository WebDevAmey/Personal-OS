import { describe, expect, it } from 'vitest';
import { parseZoned } from '@/lib/time';
import { resolveDatePhrase, resolveDateRange, type DatePrefs } from './dates';

// Thu 22 Oct 2026 08:00 New York (docs/04 §7 says "Wed"; 22 Oct 2026 is a Thursday).
const now = parseZoned('2026-10-22 08:00 America/New_York');
const prefs: DatePrefs = {
  timeZone: 'America/New_York',
  workdayStartsAt: '09:00',
  workdayEndsAt: '17:00',
  lunchEndsAt: null,
  weekStartsOn: 1,
  locale: 'en-US',
};
const due = (phrase: string, p: Partial<DatePrefs> = {}, purpose: 'due' | 'remind' | 'snooze' = 'due') =>
  resolveDatePhrase({ phrase, now, prefs: { ...prefs, ...p }, purpose });

describe('resolveDatePhrase (docs/04 §7 table)', () => {
  it('tomorrow → date-only 2026-10-23', () => {
    expect(due('tomorrow')).toMatchObject({ status: 'resolved', localDate: '2026-10-23', hasTime: false, label: 'Fri 23 Oct' });
  });

  it('tomorrow at 3pm → 19:00Z', () => {
    expect(due('tomorrow at 3pm')).toMatchObject({ status: 'resolved', instant: '2026-10-23T19:00:00.000Z', hasTime: true });
  });

  it('Saturday → the coming Saturday, date-only', () => {
    expect(due('Saturday')).toMatchObject({ status: 'resolved', localDate: '2026-10-24', hasTime: false });
  });

  it('next Friday while Friday is still ahead this week → ambiguous with both dates', () => {
    const r = due('next Friday');
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates.map((c) => c.localDate)).toEqual(['2026-10-23', '2026-10-30']);
  });

  it('next Monday (already past this week) → resolved to the coming Monday', () => {
    expect(due('next Monday')).toMatchObject({ status: 'resolved', localDate: '2026-10-26' });
  });

  it('after lunch without a preference → needs_preference lunchEndsAt', () => {
    expect(due('after lunch', {}, 'remind')).toMatchObject({ status: 'needs_preference', preference: 'lunchEndsAt' });
  });

  it('after lunch with lunchEndsAt 13:30 → 17:30Z today', () => {
    expect(due('after lunch', { lunchEndsAt: '13:30' }, 'remind')).toMatchObject({ status: 'resolved', instant: '2026-10-22T17:30:00.000Z' });
  });

  it('yesterday for a due date → past with a suggestion', () => {
    const r = due('yesterday');
    expect(r.status).toBe('past');
    if (r.status === 'past') expect(r.suggestion.localDate).toBe('2027-10-21');
  });

  it('a bare time that has passed today → past, suggesting tomorrow', () => {
    const r = due('7am');
    expect(r.status).toBe('past');
    if (r.status === 'past') expect(r.suggestion.instant).toBe('2026-10-23T11:00:00.000Z');
  });

  it('Sunday 1 Nov 1:30am (DST fall-back) → earlier offset (EDT)', () => {
    expect(due('Sunday 1 Nov 1:30am')).toMatchObject({ status: 'resolved', instant: '2026-11-01T05:30:00.000Z' });
  });

  it('spring-forward gap shifts forward and flags dst_shifted', () => {
    const march = parseZoned('2027-03-10 08:00 America/New_York');
    const r = resolveDatePhrase({ phrase: '14 March 2027 2:30am', now: march, prefs, purpose: 'due' });
    expect(r).toMatchObject({ status: 'resolved', note: 'dst_shifted', instant: '2027-03-14T07:30:00.000Z' });
  });

  it('blorp → unparseable', () => {
    expect(due('blorp')).toEqual({ status: 'unparseable' });
  });

  it('rejects ISO instants so the model cannot invent timestamps', () => {
    expect(due('2026-10-23T10:00:00Z')).toEqual({ status: 'unparseable' });
  });

  it('date-only reminder gets workday start and a defaulted_time note', () => {
    expect(due('tomorrow', {}, 'remind')).toMatchObject({ status: 'resolved', instant: '2026-10-23T13:00:00.000Z', note: 'defaulted_time' });
  });

  it('morning / end of day / tonight use preferences', () => {
    expect(due('tomorrow morning')).toMatchObject({ instant: '2026-10-23T13:00:00.000Z', hasTime: true });
    expect(due('end of day')).toMatchObject({ instant: '2026-10-22T21:00:00.000Z' });
    expect(due('tonight')).toMatchObject({ instant: '2026-10-23T00:00:00.000Z' });
    expect(due('tomorrow morning', { workdayStartsAt: null })).toMatchObject({ note: 'defaulted_time' });
  });

  it('this weekend → Saturday, next week → start of next week, the 1st → next 1st', () => {
    expect(due('this weekend')).toMatchObject({ localDate: '2026-10-24', hasTime: false });
    expect(due('next week')).toMatchObject({ localDate: '2026-10-26' });
    expect(due('on the 1st')).toMatchObject({ localDate: '2026-11-01' });
  });

  it('relative durations are instant arithmetic', () => {
    expect(due('in 2 hours')).toMatchObject({ instant: '2026-10-22T14:00:00.000Z', hasTime: true });
    expect(due('in 3 days')).toMatchObject({ localDate: '2026-10-25', hasTime: false });
  });

  it('numeric dates in a non-English locale are ambiguous', () => {
    expect(due('3/4', { locale: 'de-DE' }).status).toBe('ambiguous');
    expect(due('3/4').status).toBe('resolved');
  });
});

describe('resolveDateRange', () => {
  const range = (phrase: string) => resolveDateRange({ phrase, now, prefs });

  it('today / this week / next 3 days', () => {
    expect(range('today')).toMatchObject({ status: 'resolved', startDate: '2026-10-22', endDate: '2026-10-23' });
    expect(range('this week')).toMatchObject({ startDate: '2026-10-19', endDate: '2026-10-26' });
    expect(range('next 3 days')).toMatchObject({ startDate: '2026-10-22', endDate: '2026-10-25' });
  });

  it('tomorrow afternoon → 12:00–18:00 local', () => {
    const r = range('tomorrow afternoon');
    expect(r).toMatchObject({ status: 'resolved' });
    if (r.status === 'resolved') {
      expect(r.start.toISOString()).toBe('2026-10-23T16:00:00.000Z');
      expect(r.end.toISOString()).toBe('2026-10-23T22:00:00.000Z');
    }
  });

  it('accepts past ranges and rejects ranges over 31 days', () => {
    expect(range('last week')).toMatchObject({ status: 'resolved', startDate: '2026-10-12' });
    expect(resolveDateRange({ phrase: 'next 40 days', now, prefs })).toMatchObject({ status: 'too_long' });
  });

  it('explicit from X to Y is end-exclusive', () => {
    expect(range('from monday to wednesday')).toMatchObject({ status: 'resolved', startDate: '2026-10-26', endDate: '2026-10-29' });
  });
});
