// lib/time — pure time-zone and calendar-date helpers (leaf module: no app
// imports, no I/O). All arithmetic on user-local concepts goes through these
// functions so DST is handled in one place.
//
// Vocabulary
//  - instant      a JS Date (UTC epoch ms)
//  - LocalDate    'YYYY-MM-DD' calendar date, no zone
//  - floating     a LocalDate stored as a Date at 00:00:00.000Z (date-only
//                 task deadlines, @db.Date columns). Never shifted by a zone.

export type LocalDate = string; // YYYY-MM-DD

export interface WallTime {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

export interface ZonedParts extends Required<WallTime> {
  weekday: number; // 0 = Sunday … 6 = Saturday
}

const DAY_MS = 86_400_000;
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

let zoneSet: Set<string> | null = null;

/** True for IANA zone names the runtime knows (plus "UTC"). */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  if (!zoneSet) {
    const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    zoneSet = new Set([...supported, 'UTC', 'Etc/UTC']);
  }
  if (zoneSet.has(timeZone)) return true;
  // Accept canonical aliases the runtime resolves (e.g. "Asia/Calcutta").
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return /^[A-Za-z]+(?:[/_+-][A-Za-z0-9_+-]+)*$/.test(timeZone);
  } catch {
    return false;
  }
}

export function assertTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Unknown time zone: ${timeZone}`);
}

/** Wall-clock parts of `instant` in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return {
    year,
    month,
    day,
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (NY winter = -5h). */
export function offsetMs(instant: Date | number, timeZone: string): number {
  const t = typeof instant === 'number' ? instant : instant.getTime();
  const p = zonedParts(new Date(t), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

export type Disambiguation = 'earlier' | 'later';

/**
 * Converts a wall-clock time in `timeZone` to an instant.
 * - Ambiguous times (DST fall-back) resolve to the earlier instant by default.
 * - Nonexistent times (DST spring-forward gap) move forward by the gap
 *   (02:30 on 2026-03-08 in New York → 03:30 EDT), matching RFC 5545.
 */
export function zonedTimeToUtc(wall: WallTime, timeZone: string, disambiguation: Disambiguation = 'earlier'): Date {
  const localMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second ?? 0);
  const before = offsetMs(localMs - DAY_MS, timeZone);
  const after = offsetMs(localMs + DAY_MS, timeZone);
  const candidates = [...new Set([localMs - before, localMs - after])]
    .filter((t) => {
      const p = zonedParts(new Date(t), timeZone);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) === localMs;
    })
    .sort((a, b) => a - b);
  if (candidates.length === 0) {
    // In a gap: interpret with the pre-transition offset, which lands after the gap.
    return new Date(localMs - before);
  }
  return new Date(disambiguation === 'earlier' ? candidates[0] : candidates[candidates.length - 1]);
}

// ───────────────────────── LocalDate helpers ─────────────────────────

export function isLocalDate(value: string): boolean {
  const m = LOCAL_DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function parseLocalDate(value: LocalDate): { year: number; month: number; day: number } {
  if (!isLocalDate(value)) throw new RangeError(`Invalid local date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Calendar date of `instant` in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const p = zonedParts(instant, timeZone);
  return formatLocalDate(p.year, p.month, p.day);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((floatingDate(b).getTime() - floatingDate(a).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  return floatingDate(date).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The instant at which `date` starts in `timeZone` (handles 23/25-hour days). */
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  return zonedTimeToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
}

/** [start, end) instants of a local calendar day. */
export function localDayRange(date: LocalDate, timeZone: string): { start: Date; end: Date } {
  return { start: startOfLocalDay(date, timeZone), end: startOfLocalDay(addDays(date, 1), timeZone) };
}

// ───────────────────────── Floating dates ─────────────────────────

/** LocalDate → Date at 00:00:00.000Z (date-only deadlines, @db.Date). */
export function floatingDate(date: LocalDate): Date {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isFloatingDate(value: Date): boolean {
  return value.getTime() % DAY_MS === 0;
}

/** Date at 00:00Z → LocalDate (reads the UTC calendar fields). */
export function floatingToLocalDate(value: Date): LocalDate {
  return formatLocalDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

// ───────────────────────── HH:mm ─────────────────────────

export function isHHmm(value: string): boolean {
  return HHMM_RE.test(value);
}

export function parseHHmm(value: string): { hour: number; minute: number } {
  const m = HHMM_RE.exec(value);
  if (!m) throw new RangeError(`Invalid HH:mm: ${value}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Wall time `HH:mm` on `date` in `timeZone` → instant. */
export function atLocalTime(date: LocalDate, hhmm: string, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const { hour, minute } = parseHHmm(hhmm);
  return zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);
}

/**
 * Parses "YYYY-MM-DD HH:mm[:ss] Zone/Name" (or "YYYY-MM-DD Zone/Name" for
 * midnight) into an instant. Used by tests so DST cases read as wall time.
 */
export function parseZoned(value: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?\s+(\S+)$/.exec(value.trim());
  if (!m) throw new RangeError(`Invalid zoned time: ${value}`);
  const { year, month, day } = parseLocalDate(m[1]);
  assertTimeZone(m[5]);
  return zonedTimeToUtc(
    { year, month, day, hour: Number(m[2] ?? 0), minute: Number(m[3] ?? 0), second: Number(m[4] ?? 0) },
    m[5],
  );
}
