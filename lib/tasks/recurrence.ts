// lib/tasks/recurrence.ts — RFC 5545 RRULE subset (FR-230), pure.
//
// Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (ordinals
// such as 1MO / -1FR for MONTHLY), BYMONTHDAY, BYHOUR + BYMINUTE (single
// values; pin the wall-clock time of timed series), UNTIL. Anything else
// (COUNT, BYSETPOS, WKST other than MO, …) is rejected.
//
// Occurrences are computed on the local calendar (in the task's time zone)
// and anchored on the schedule, never on the completion date. Timed
// occurrences are converted to instants per occurrence, so a 09:00 task stays
// at 09:00 local across DST transitions.

import {
  addDays,
  daysInMonth,
  floatingDate,
  floatingToLocalDate,
  formatLocalDate,
  localDateOf,
  parseLocalDate,
  weekdayOf,
  zonedParts,
  zonedTimeToUtc,
  type LocalDate,
} from '@/lib/time';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface ByDay {
  weekday: number; // 0 = SU … 6 = SA
  ordinal?: number; // MONTHLY only: 1..5 or -1..-5
}

export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  byDay: ByDay[];
  byMonthDay: number[];
  byHour?: number;
  byMinute?: number;
  until?: Date;
}

export class RecurrenceRuleError extends Error {
  readonly code = 'INVALID_RECURRENCE';
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceRuleError';
  }
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_ITERATIONS = 5000;

export function parseRRule(input: string): RecurrenceRule {
  if (typeof input !== 'string' || input.trim().length === 0) throw new RecurrenceRuleError('Recurrence rule is empty');
  const body = input.trim().replace(/^RRULE:/i, '');
  if (body.length > 200) throw new RecurrenceRuleError('Recurrence rule is too long');
  const seen = new Set<string>();
  const rule: Partial<RecurrenceRule> = { interval: 1, byDay: [], byMonthDay: [] };

  for (const part of body.split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) throw new RecurrenceRuleError(`Malformed rule part "${part}"`);
    const key = part.slice(0, eq).toUpperCase();
    const value = part.slice(eq + 1).toUpperCase();
    if (seen.has(key)) throw new RecurrenceRuleError(`Duplicate ${key}`);
    seen.add(key);
    switch (key) {
      case 'FREQ':
        if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(value)) {
          throw new RecurrenceRuleError(`Unsupported FREQ "${value}" (use DAILY, WEEKLY, MONTHLY or YEARLY)`);
        }
        rule.freq = value as Frequency;
        break;
      case 'INTERVAL': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 366) throw new RecurrenceRuleError('INTERVAL must be an integer 1–366');
        rule.interval = n;
        break;
      }
      case 'BYDAY':
        rule.byDay = value.split(',').map((token) => {
          const m = /^([+-]?[1-5])?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token);
          if (!m) throw new RecurrenceRuleError(`Invalid BYDAY value "${token}"`);
          const day: ByDay = { weekday: WEEKDAYS.indexOf(m[2] as (typeof WEEKDAYS)[number]) };
          if (m[1]) day.ordinal = Number(m[1]);
          return day;
        });
        break;
      case 'BYMONTHDAY':
        rule.byMonthDay = value.split(',').map((token) => {
          const n = Number(token);
          if (!Number.isInteger(n) || n === 0 || n < -31 || n > 31) throw new RecurrenceRuleError(`Invalid BYMONTHDAY "${token}"`);
          return n;
        });
        break;
      case 'BYHOUR': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 23) throw new RecurrenceRuleError('BYHOUR must be a single hour 0–23');
        rule.byHour = n;
        break;
      }
      case 'BYMINUTE': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 59) throw new RecurrenceRuleError('BYMINUTE must be a single minute 0–59');
        rule.byMinute = n;
        break;
      }
      case 'UNTIL': {
        const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(value);
        if (!m) throw new RecurrenceRuleError('UNTIL must be YYYYMMDD or YYYYMMDDTHHMMSSZ');
        const [, y, mo, d, h, mi, s] = m;
        rule.until = h
          ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
          : new Date(Date.UTC(+y, +mo - 1, +d, 23, 59, 59, 999));
        break;
      }
      case 'WKST':
        if (value !== 'MO') throw new RecurrenceRuleError('Only WKST=MO is supported');
        break;
      default:
        throw new RecurrenceRuleError(`Unsupported rule part ${key}`);
    }
  }

  if (!rule.freq) throw new RecurrenceRuleError('FREQ is required');
  if (rule.byDay!.some((d) => d.ordinal !== undefined) && rule.freq !== 'MONTHLY') {
    throw new RecurrenceRuleError('BYDAY ordinals (e.g. 1MO, -1FR) are only supported with FREQ=MONTHLY');
  }
  if (rule.byMonthDay!.length > 0 && rule.freq !== 'MONTHLY') {
    throw new RecurrenceRuleError('BYMONTHDAY is only supported with FREQ=MONTHLY');
  }
  if (rule.byMonthDay!.length > 0 && rule.byDay!.length > 0) {
    throw new RecurrenceRuleError('Use either BYDAY or BYMONTHDAY, not both');
  }
  if (rule.freq === 'YEARLY' && rule.byDay!.length > 0) {
    throw new RecurrenceRuleError('BYDAY is not supported with FREQ=YEARLY');
  }
  if ((rule.byHour === undefined) !== (rule.byMinute === undefined)) {
    throw new RecurrenceRuleError('BYHOUR and BYMINUTE must be given together');
  }
  return rule as RecurrenceRule;
}

export function formatRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length) parts.push(`BYDAY=${rule.byDay.map((d) => `${d.ordinal ?? ''}${WEEKDAYS[d.weekday]}`).join(',')}`);
  if (rule.byMonthDay.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.byHour !== undefined) parts.push(`BYHOUR=${rule.byHour}`, `BYMINUTE=${rule.byMinute}`);
  if (rule.until) {
    const u = rule.until;
    const pad = (n: number) => String(n).padStart(2, '0');
    parts.push(
      `UNTIL=${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}${pad(u.getUTCSeconds())}Z`,
    );
  }
  return parts.join(';');
}

/** Validates and canonicalises a rule string; throws RecurrenceRuleError. */
export function normalizeRRule(input: string): string {
  return formatRRule(parseRRule(input));
}

/**
 * For timed series, pins the local wall time into the rule (BYHOUR/BYMINUTE)
 * so an occurrence moved by a DST gap does not drift the rest of the series.
 */
export function pinWallTime(input: string, dueAt: Date, timeZone: string): string {
  const rule = parseRRule(input);
  if (rule.byHour === undefined) {
    const p = zonedParts(dueAt, timeZone);
    rule.byHour = p.hour;
    rule.byMinute = p.minute;
  }
  return formatRRule(rule);
}

// ───────────────────────── occurrence generation ─────────────────────────

function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number): number | null {
  const dim = daysInMonth(year, month);
  if (ordinal > 0) {
    const firstWeekday = weekdayOf(formatLocalDate(year, month, 1));
    const day = 1 + ((weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
    return day <= dim ? day : null;
  }
  const lastWeekday = weekdayOf(formatLocalDate(year, month, dim));
  const day = dim - ((lastWeekday - weekday + 7) % 7) + (ordinal + 1) * 7;
  return day >= 1 ? day : null;
}

/** Candidate local dates of one period, ascending. */
function datesInPeriod(rule: RecurrenceRule, anchor: LocalDate, periodIndex: number): LocalDate[] {
  const a = parseLocalDate(anchor);
  switch (rule.freq) {
    case 'DAILY': {
      const d = addDays(anchor, periodIndex * rule.interval);
      if (rule.byDay.length && !rule.byDay.some((b) => b.weekday === weekdayOf(d))) return [];
      return [d];
    }
    case 'WEEKLY': {
      // Weeks start on Monday (WKST=MO).
      const anchorMonday = addDays(anchor, -((weekdayOf(anchor) + 6) % 7));
      const monday = addDays(anchorMonday, periodIndex * rule.interval * 7);
      const weekdays = rule.byDay.length ? rule.byDay.map((b) => b.weekday) : [weekdayOf(anchor)];
      return [...new Set(weekdays)]
        .map((wd) => addDays(monday, (wd + 6) % 7))
        .sort();
    }
    case 'MONTHLY': {
      const monthIndex = a.month - 1 + periodIndex * rule.interval;
      const year = a.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const dim = daysInMonth(year, month);
      const days = new Set<number>();
      if (rule.byMonthDay.length) {
        for (const md of rule.byMonthDay) {
          const day = md > 0 ? md : dim + md + 1;
          if (day >= 1 && day <= dim) days.add(day);
        }
      } else if (rule.byDay.length) {
        for (const b of rule.byDay) {
          if (b.ordinal !== undefined) {
            const day = nthWeekdayOfMonth(year, month, b.weekday, b.ordinal);
            if (day) days.add(day);
          } else {
            for (let day = 1; day <= dim; day++) if (weekdayOf(formatLocalDate(year, month, day)) === b.weekday) days.add(day);
          }
        }
      } else if (a.day <= dim) {
        days.add(a.day); // RFC 5545: months without that day are skipped
      }
      return [...days].sort((x, y) => x - y).map((day) => formatLocalDate(year, month, day));
    }
    case 'YEARLY': {
      const year = a.year + periodIndex * rule.interval;
      return a.day <= daysInMonth(year, a.month) ? [formatLocalDate(year, a.month, a.day)] : [];
    }
  }
}

export interface OccurrenceInput {
  /** Current occurrence's deadline (floating date when !dueHasTime). */
  dueAt: Date;
  dueHasTime: boolean;
  /** IANA zone the series is interpreted in. */
  timeZone: string;
}

export interface NextOccurrenceOptions {
  /** Occurrences before this point are "missed" and rolled over. */
  now: Date;
}

/**
 * The first occurrence strictly after the current one that is not already
 * in the past (missed occurrences roll forward). Returns null when the rule's
 * UNTIL has passed.
 *  - timed: the next occurrence instant > now
 *  - date-only: the next occurrence date ≥ today (in `timeZone`)
 */
export function nextOccurrence(ruleInput: string | RecurrenceRule, current: OccurrenceInput, opts: NextOccurrenceOptions): Date | null {
  const rule = typeof ruleInput === 'string' ? parseRRule(ruleInput) : ruleInput;
  const anchor = current.dueHasTime ? localDateOf(current.dueAt, current.timeZone) : floatingToLocalDate(current.dueAt);
  const wall = current.dueHasTime ? zonedParts(current.dueAt, current.timeZone) : null;
  const hour = rule.byHour ?? wall?.hour ?? 0;
  const minute = rule.byMinute ?? wall?.minute ?? 0;
  const today = localDateOf(opts.now, current.timeZone);

  const toInstant = (date: LocalDate): Date => {
    if (!current.dueHasTime) return floatingDate(date);
    const { year, month, day } = parseLocalDate(date);
    return zonedTimeToUtc({ year, month, day, hour, minute }, current.timeZone);
  };

  let iterations = 0;
  for (let period = 0; iterations < MAX_ITERATIONS; period++) {
    for (const date of datesInPeriod(rule, anchor, period)) {
      iterations++;
      if (date <= anchor) continue;
      const instant = toInstant(date);
      if (rule.until && (current.dueHasTime ? instant > rule.until : floatingDate(date) > rule.until)) return null;
      const isFuture = current.dueHasTime ? instant > opts.now : date >= today;
      if (isFuture) return instant;
    }
    iterations++;
  }
  return null;
}

/** First `count` occurrences after the current one, ignoring `now` (previews). */
export function upcomingOccurrences(ruleInput: string, current: OccurrenceInput, count: number): Date[] {
  const out: Date[] = [];
  let cursor = current;
  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(ruleInput, cursor, { now: new Date(0) });
    if (!next) break;
    out.push(next);
    cursor = { ...cursor, dueAt: next };
  }
  return out;
}

/** Plain-English summary (FR-233), e.g. "Every weekday", "Monthly on the last Friday". */
export function describeRRule(input: string): string {
  const rule = parseRRule(input);
  const every = (unit: string) => (rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`);
  const ordinalName = (n: number) => (n === -1 ? 'last' : n === -2 ? 'second-to-last' : ['first', 'second', 'third', 'fourth', 'fifth'][n - 1]);
  const dayList = (days: ByDay[]) => days.map((d) => WEEKDAY_NAMES[d.weekday]).join(', ');
  const isWeekdays = (days: ByDay[]) => days.length === 5 && [1, 2, 3, 4, 5].every((wd) => days.some((d) => d.weekday === wd && d.ordinal === undefined));
  let text: string;
  switch (rule.freq) {
    case 'DAILY':
      text = rule.byDay.length ? (isWeekdays(rule.byDay) && rule.interval === 1 ? 'Every weekday' : `${every('day')} on ${dayList(rule.byDay)}`) : every('day');
      break;
    case 'WEEKLY':
      if (rule.byDay.length && isWeekdays(rule.byDay) && rule.interval === 1) text = 'Every weekday';
      else text = rule.byDay.length ? `${every('week')} on ${dayList(rule.byDay)}` : every('week');
      break;
    case 'MONTHLY':
      if (rule.byMonthDay.length) {
        text = `${rule.interval === 1 ? 'Monthly' : every('month')} on day ${rule.byMonthDay.map((d) => (d === -1 ? 'last' : d)).join(', ')}`;
      } else if (rule.byDay.length) {
        text = `${rule.interval === 1 ? 'Monthly' : every('month')} on the ${rule.byDay
          .map((d) => (d.ordinal !== undefined ? `${ordinalName(d.ordinal)} ${WEEKDAY_NAMES[d.weekday]}` : `every ${WEEKDAY_NAMES[d.weekday]}`))
          .join(', ')}`;
      } else text = rule.interval === 1 ? 'Monthly' : every('month');
      break;
    case 'YEARLY':
      text = rule.interval === 1 ? 'Yearly' : every('year');
      break;
  }
  if (rule.byHour !== undefined) text += ` at ${String(rule.byHour).padStart(2, '0')}:${String(rule.byMinute).padStart(2, '0')}`;
  if (rule.until) text += ` until ${rule.until.toISOString().slice(0, 10)}`;
  return text;
}
