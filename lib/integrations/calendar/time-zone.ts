// lib/integrations/calendar/time-zone.ts
//
// Converts local calendar dates in an IANA zone to UTC instants using only
// Intl (no tz database dependency). Handles DST transitions: a local day can
// be 23 or 25 hours long, and in zones whose clocks jump at midnight the day
// starts at the first instant that exists.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** True when `timeZone` is an IANA zone (or UTC) known to this runtime. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of `timeZone` from UTC at instant `utcMs`, in ms (local - UTC). */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export function parseLocalDate(value: string): { y: number; m: number; d: number } | null {
  const match = DATE.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** UTC instant of local midnight at the start of `date` (YYYY-MM-DD) in `timeZone`. */
export function startOfLocalDayUtc(date: string, timeZone: string): Date {
  const parsed = parseLocalDate(date);
  if (!parsed) throw new RangeError('Invalid local date');
  const wall = Date.UTC(parsed.y, parsed.m - 1, parsed.d);
  // First guess uses the offset at wall-clock-read-as-UTC; the second
  // corrects for a transition between that guess and the answer. When the
  // two differ, keep the earliest one that actually falls on `date` (if
  // midnight was skipped by a spring-forward, that is the transition
  // instant, i.e. the first moment of the local day).
  const first = wall - zoneOffsetMs(wall, timeZone);
  const second = wall - zoneOffsetMs(first, timeZone);
  const onDate = [first, second].filter((c) => localDateOf(c, timeZone) === date);
  return new Date(onDate.length > 0 ? Math.min(...onDate) : second);
}

/** Local YYYY-MM-DD of an instant in `timeZone`. */
export function localDateOf(utcMs: number, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const parsed = parseLocalDate(date);
  if (!parsed) throw new RangeError('Invalid local date');
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d + days)).toISOString().slice(0, 10);
}

/** UTC instants bounding local dates `startDate`..`endDate` (inclusive) in `timeZone`. */
export function localDateRangeToUtc(startDate: string, endDate: string, timeZone: string): { timeMin: Date; timeMax: Date } {
  return {
    timeMin: startOfLocalDayUtc(startDate, timeZone),
    timeMax: startOfLocalDayUtc(addDays(endDate, 1), timeZone),
  };
}
