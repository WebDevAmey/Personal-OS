// lib/commands/dates.ts — deterministic natural-language date resolution
// (ADR-008, docs/04 §7). Pure: no I/O, the clock is a parameter.
//
// The model passes the user's phrase ("tomorrow", "after lunch"); this module
// turns it into an instant with the user's time zone and preferences, or says
// why it can't (ambiguous / needs a preference / in the past / unparseable),
// in which case the caller asks the user instead of guessing.
//
// chrono-node is given the user's UTC offset at `now` and only its wall-clock
// components are used; the instant is rebuilt with lib/time so DST is handled
// in one place (gaps shift forward, overlaps take the earlier offset).
import * as chrono from 'chrono-node';
import {
  addDays,
  daysInMonth,
  formatLocalDate,
  localDateOf,
  offsetMs,
  parseLocalDate,
  startOfLocalDay,
  weekdayOf,
  zonedParts,
  zonedTimeToUtc,
  type LocalDate,
} from '@/lib/time';

export type Purpose = 'due' | 'start' | 'remind' | 'snooze' | 'range';

export interface DatePrefs {
  timeZone: string;
  /** 'HH:mm'; null → default 09:00 with note 'defaulted_time'. */
  workdayStartsAt: string | null;
  /** 'HH:mm'; null → default 17:00 with note 'defaulted_time'. */
  workdayEndsAt: string | null;
  /** 'HH:mm'; no default: "after lunch" needs it. */
  lunchEndsAt: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
  locale?: string;
}

export type DateNote = 'dst_shifted' | 'defaulted_time';

export interface DateCandidate {
  instant: string;
  hasTime: boolean;
  localDate: LocalDate;
  label: string;
}

export type DateResolution =
  | {
      status: 'resolved';
      instant: string;
      hasTime: boolean;
      localDate: LocalDate;
      end?: string;
      timeZone: string;
      label: string;
      note?: DateNote;
    }
  | { status: 'ambiguous'; candidates: DateCandidate[] }
  | { status: 'needs_preference'; preference: 'lunchEndsAt' | 'timeZone'; question: string }
  | { status: 'past'; instant: string; label: string; suggestion: DateCandidate }
  | { status: 'unparseable' };

export interface RangeResolution {
  status: 'resolved';
  start: Date;
  end: Date;
  startDate: LocalDate;
  /** Exclusive local end date. */
  endDate: LocalDate;
  label: string;
}

export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/;
const DEFAULT_WORKDAY_START = '09:00';
const DEFAULT_WORKDAY_END = '17:00';
const DAY_MS = 86_400_000;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?';
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function weekdayIndex(token: string): number {
  const t = token.slice(0, 3).toLowerCase();
  return WEEKDAYS.findIndex((d) => d.startsWith(t));
}

// ───────────────────────── labels ─────────────────────────

/** "Thu 23 Oct" (+ year when not the current one). */
export function dateLabel(localDate: LocalDate, now?: Date, timeZone?: string): string {
  const { year, month, day } = parseLocalDate(localDate);
  const currentYear = now && timeZone ? zonedParts(now, timeZone).year : year;
  return `${SHORT_DAYS[weekdayOf(localDate)]} ${day} ${SHORT_MONTHS[month - 1]}${year !== currentYear ? ` ${year}` : ''}`;
}

/** "Thu 23 Oct 15:00" in `timeZone`. */
export function instantLabel(instant: Date, timeZone: string, now?: Date): string {
  const p = zonedParts(instant, timeZone);
  const date = formatLocalDate(p.year, p.month, p.day);
  return `${dateLabel(date, now, timeZone)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// ───────────────────────── helpers ─────────────────────────

function normalise(phrase: string): string {
  return phrase.toLowerCase().replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ').trim();
}

function chronoParser(locale: string | undefined) {
  return locale && /^en-(gb|au|nz|ie|in|za)/i.test(locale) ? chrono.en.GB : chrono.en.casual;
}

function dateCandidate(localDate: LocalDate, prefs: DatePrefs, now: Date): DateCandidate {
  return { instant: startOfLocalDay(localDate, prefs.timeZone).toISOString(), hasTime: false, localDate, label: dateLabel(localDate, now, prefs.timeZone) };
}

function timedCandidate(instant: Date, prefs: DatePrefs, now: Date): DateCandidate {
  return { instant: instant.toISOString(), hasTime: true, localDate: localDateOf(instant, prefs.timeZone), label: instantLabel(instant, prefs.timeZone, now) };
}

/** Wall time → instant, flagging a DST gap shift. */
function atWall(localDate: LocalDate, hour: number, minute: number, timeZone: string): { instant: Date; shifted: boolean } {
  const { year, month, day } = parseLocalDate(localDate);
  const instant = zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);
  const p = zonedParts(instant, timeZone);
  return { instant, shifted: p.hour !== hour || p.minute !== minute || formatLocalDate(p.year, p.month, p.day) !== localDate };
}

function hhmm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':').map(Number);
  return { hour: h, minute: m };
}

function startOfWeek(today: LocalDate, weekStartsOn: number): LocalDate {
  const back = (weekdayOf(today) - weekStartsOn + 7) % 7;
  return addDays(today, -back);
}

/** Next date (today or later) with day-of-month `n`. */
function nextDayOfMonth(today: LocalDate, n: number): LocalDate | null {
  if (n < 1 || n > 31) return null;
  let { year, month } = parseLocalDate(today);
  for (let i = 0; i < 13; i++) {
    if (n <= daysInMonth(year, month)) {
      const candidate = formatLocalDate(year, month, n);
      if (candidate >= today) return candidate;
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

interface Expanded {
  /** Phrase rewritten for chrono. */
  text: string;
  /** A fixed local date decided by vocabulary (date-only unless `time`). */
  date?: LocalDate;
  time?: { hour: number; minute: number };
  defaulted?: boolean;
}

/**
 * Applies the vocabulary rules (§7 rule 3) before chrono: time-of-day words
 * become explicit times from preferences; "this weekend", "next week" and
 * "the 1st" become dates chrono can't produce reliably.
 */
function expandVocabulary(p: string, prefs: DatePrefs, today: LocalDate): Expanded | { needsLunch: true } {
  let text = p;
  let defaulted = false;
  const timeWord = (re: RegExp, value: string | null, fallback: string) => {
    if (!re.test(text)) return;
    if (value === null) defaulted = true;
    const t = value ?? fallback;
    text = text.replace(re, (_m, prefix: string | undefined) => {
      const pre = (prefix ?? '').trim();
      const day = pre === 'this' || pre === '' ? (pre === 'this' ? 'today ' : '') : `${pre} `;
      return `${day}at ${t}`;
    });
  };

  if (/\bafter lunch\b/.test(text)) {
    if (!prefs.lunchEndsAt) return { needsLunch: true };
    timeWord(/(?:\b(this|today|tomorrow|[a-z]+day)\s+)?after lunch\b/, prefs.lunchEndsAt, prefs.lunchEndsAt);
  }
  timeWord(/(?:\b(this|today|tomorrow|[a-z]+day)\s+)?(?:in the )?morning\b/, prefs.workdayStartsAt, DEFAULT_WORKDAY_START);
  timeWord(/(?:\b(today|tomorrow|[a-z]+day)\s+)?(?:at |by )?(?:the )?(?:end of (?:the )?day|eod)\b/, prefs.workdayEndsAt, DEFAULT_WORKDAY_END);
  if (/\btonight\b/.test(text)) text = text.replace(/\btonight\b/, 'today at 20:00');
  timeWord(/(?:\b(this|today|tomorrow|[a-z]+day)\s+)?(?:in the )?afternoon\b/, prefs.lunchEndsAt, '13:00');
  timeWord(/(?:\b(this|today|tomorrow|[a-z]+day)\s+)?(?:in the )?evening\b/, '18:00', '18:00');
  text = text.replace(/\bthis (today|tomorrow)\b/, '$1');

  if (/^(this )?weekend$/.test(text)) {
    const wd = weekdayOf(today);
    return { text, date: wd === 6 || wd === 0 ? today : addDays(today, 6 - wd), defaulted };
  }
  if (/^next week$/.test(text)) {
    return { text, date: addDays(startOfWeek(today, prefs.weekStartsOn), 7), defaulted };
  }
  const nth = /^(?:on )?the (\d{1,2})(?:st|nd|rd|th)?(?: of (?:the|this) month)?$/.exec(text);
  if (nth) {
    const date = nextDayOfMonth(today, Number(nth[1]));
    if (date) return { text, date, defaulted };
  }
  return { text, defaulted };
}

function relativeDuration(p: string, now: Date, prefs: DatePrefs, purpose: Purpose): DateResolution | null {
  const m = /^in (\d{1,4}|an?|one|two|three|four|five|six|seven|eight|nine|ten) (minute|min|hour|hr|day|week)s?$/.exec(p);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  const unit = m[2];
  if (unit === 'minute' || unit === 'min' || unit === 'hour' || unit === 'hr') {
    const instant = new Date(now.getTime() + n * (unit.startsWith('h') ? 3_600_000 : 60_000));
    return {
      status: 'resolved',
      instant: instant.toISOString(),
      hasTime: true,
      localDate: localDateOf(instant, prefs.timeZone),
      timeZone: prefs.timeZone,
      label: instantLabel(instant, prefs.timeZone, now),
    };
  }
  const localDate = addDays(localDateOf(now, prefs.timeZone), n * (unit === 'week' ? 7 : 1));
  return resolvedDate(localDate, prefs, now, purpose);
}

function resolvedDate(localDate: LocalDate, prefs: DatePrefs, now: Date, purpose: Purpose): DateResolution {
  if (purpose === 'remind' || purpose === 'snooze') {
    const t = hhmm(prefs.workdayStartsAt ?? DEFAULT_WORKDAY_START);
    return resolvedTime(localDate, t.hour, t.minute, prefs, now, 'defaulted_time');
  }
  return {
    status: 'resolved',
    instant: startOfLocalDay(localDate, prefs.timeZone).toISOString(),
    hasTime: false,
    localDate,
    timeZone: prefs.timeZone,
    label: dateLabel(localDate, now, prefs.timeZone),
  };
}

function resolvedTime(localDate: LocalDate, hour: number, minute: number, prefs: DatePrefs, now: Date, note?: DateNote): DateResolution {
  const { instant, shifted } = atWall(localDate, hour, minute, prefs.timeZone);
  const finalNote: DateNote | undefined = shifted ? 'dst_shifted' : note;
  return {
    status: 'resolved',
    instant: instant.toISOString(),
    hasTime: true,
    localDate: localDateOf(instant, prefs.timeZone),
    timeZone: prefs.timeZone,
    label: instantLabel(instant, prefs.timeZone, now),
    ...(finalNote ? { note: finalNote } : {}),
  };
}

/** Past check (§7 rule 5) for everything but ranges. */
function checkPast(r: DateResolution, purpose: Purpose, now: Date, prefs: DatePrefs, timeOnly: boolean): DateResolution {
  if (r.status !== 'resolved' || purpose === 'range' || purpose === 'start') return r;
  const today = localDateOf(now, prefs.timeZone);
  const isPast = r.hasTime ? new Date(r.instant).getTime() < now.getTime() : r.localDate < today;
  if (!isPast) return r;
  let suggestion: DateCandidate;
  if (timeOnly && r.hasTime) {
    const p = zonedParts(new Date(r.instant), prefs.timeZone);
    const next = atWall(addDays(r.localDate, 1), p.hour, p.minute, prefs.timeZone).instant;
    suggestion = timedCandidate(next, prefs, now);
  } else {
    const { year, month, day } = parseLocalDate(r.localDate);
    const nextYear = formatLocalDate(year + 1, month, Math.min(day, daysInMonth(year + 1, month)));
    if (r.hasTime) {
      const p = zonedParts(new Date(r.instant), prefs.timeZone);
      suggestion = timedCandidate(atWall(nextYear, p.hour, p.minute, prefs.timeZone).instant, prefs, now);
    } else {
      suggestion = dateCandidate(nextYear, prefs, now);
    }
  }
  return { status: 'past', instant: r.instant, label: r.label, suggestion };
}

// ───────────────────────── public API ─────────────────────────

export function resolveDatePhrase(input: { phrase: string; now: Date; prefs: DatePrefs; purpose: Purpose }): DateResolution {
  const { now, prefs, purpose } = input;
  if (typeof input.phrase !== 'string' || ISO_INSTANT.test(input.phrase.trim())) return { status: 'unparseable' };
  const p = normalise(input.phrase);
  if (!p || p.length > 80) return { status: 'unparseable' };
  const today = localDateOf(now, prefs.timeZone);

  // Explicit calendar date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
    try {
      parseLocalDate(p);
    } catch {
      return { status: 'unparseable' };
    }
    return checkPast(resolvedDate(p, prefs, now, purpose), purpose, now, prefs, false);
  }

  const rel = relativeDuration(p, now, prefs, purpose);
  if (rel) return checkPast(rel, purpose, now, prefs, false);

  const expanded = expandVocabulary(p, prefs, today);
  if ('needsLunch' in expanded) {
    return { status: 'needs_preference', preference: 'lunchEndsAt', question: 'When does lunch usually end for you?' };
  }
  const defaultedNote: DateNote | undefined = expanded.defaulted ? 'defaulted_time' : undefined;
  if (expanded.date) return checkPast(resolvedDate(expanded.date, prefs, now, purpose), purpose, now, prefs, false);

  // "next <weekday>" while that weekday is still ahead this week → ask.
  const nextWd = new RegExp(`^next ${WEEKDAY_RE}$`).exec(expanded.text);
  if (nextWd) {
    const target = weekdayIndex(nextWd[1]);
    const weekStart = startOfWeek(today, prefs.weekStartsOn);
    const thisWeek = addDays(weekStart, (target - prefs.weekStartsOn + 7) % 7);
    if (thisWeek > today) {
      const following = addDays(thisWeek, 7);
      return {
        status: 'ambiguous',
        candidates: [thisWeek, following].map((d) => {
          const r = resolvedDate(d, prefs, now, purpose) as Extract<DateResolution, { status: 'resolved' }>;
          return { instant: r.instant, hasTime: r.hasTime, localDate: r.localDate, label: r.label };
        }),
      };
    }
  }

  // Numeric day/month with a locale we can't read either way → ask.
  const numeric = /^(\d{1,2})\/(\d{1,2})$/.exec(expanded.text);
  if (numeric && prefs.locale && !/^en(-|$)/i.test(prefs.locale)) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const candidates: DateCandidate[] = [];
    for (const [month, day] of [[a, b], [b, a]]) {
      if (month < 1 || month > 12) continue;
      const { year } = parseLocalDate(today);
      for (const y of [year, year + 1]) {
        if (day <= daysInMonth(y, month)) {
          const d = formatLocalDate(y, month, day);
          if (d >= today) {
            candidates.push(dateCandidate(d, prefs, now));
            break;
          }
        }
      }
    }
    const unique = candidates.filter((c, i) => candidates.findIndex((x) => x.localDate === c.localDate) === i);
    if (unique.length > 1) return { status: 'ambiguous', candidates: unique };
  }

  const reference = { instant: now, timezone: Math.round(offsetMs(now, prefs.timeZone) / 60_000) };
  const results = chronoParser(prefs.locale).parse(expanded.text, reference, { forwardDate: true });
  if (results.length === 0) return { status: 'unparseable' };

  const read = (r: chrono.ParsedResult) => {
    const s = r.start;
    const year = s.get('year')!;
    const month = s.get('month')!;
    const day = s.get('day')!;
    return {
      localDate: formatLocalDate(year, month, day),
      hasTime: s.isCertain('hour'),
      hour: s.get('hour') ?? 0,
      minute: s.get('minute') ?? 0,
      dateGiven: s.isCertain('day') || s.isCertain('weekday') || s.isCertain('month'),
    };
  };
  const parsed = results.map(read);
  const distinct = [...new Set(parsed.map((r) => r.localDate))];
  if (distinct.length > 1) {
    return {
      status: 'ambiguous',
      candidates: parsed.slice(0, 4).map((r) =>
        r.hasTime ? timedCandidate(atWall(r.localDate, r.hour, r.minute, prefs.timeZone).instant, prefs, now) : dateCandidate(r.localDate, prefs, now),
      ),
    };
  }

  const first = parsed[0];
  // A bare time ("4pm") means today; chrono's forwardDate would silently roll it to tomorrow.
  const timeOnly = first.hasTime && !first.dateGiven;
  const localDate = timeOnly ? today : first.localDate;
  const resolved = first.hasTime
    ? resolvedTime(localDate, first.hour, first.minute, prefs, now, defaultedNote)
    : resolvedDate(localDate, prefs, now, purpose);
  return checkPast(resolved, purpose, now, prefs, timeOnly);
}

/** Resolves a range phrase ("today", "this week", "tomorrow afternoon", "from Mon to Wed"). End is exclusive. */
export function resolveDateRange(input: { phrase: string; now: Date; prefs: DatePrefs; maxDays?: number }):
  | RangeResolution
  | { status: 'unparseable' }
  | { status: 'too_long'; maxDays: number }
  | Exclude<DateResolution, { status: 'resolved' } | { status: 'past' }> {
  const { now, prefs } = input;
  const maxDays = input.maxDays ?? 31;
  const p = normalise(input.phrase || 'today');
  const tz = prefs.timeZone;
  const today = localDateOf(now, tz);

  const days = (startDate: LocalDate, count: number, label?: string): RangeResolution => {
    const endDate = addDays(startDate, count);
    return {
      status: 'resolved',
      start: startOfLocalDay(startDate, tz),
      end: startOfLocalDay(endDate, tz),
      startDate,
      endDate,
      label: label ?? (count === 1 ? dateLabel(startDate, now, tz) : `${dateLabel(startDate, now, tz)} – ${dateLabel(addDays(endDate, -1), now, tz)}`),
    };
  };
  const finish = (r: RangeResolution) => {
    if (r.end.getTime() - r.start.getTime() > maxDays * DAY_MS + 3_600_000) return { status: 'too_long' as const, maxDays };
    return r;
  };

  if (p === 'today') return days(today, 1, 'Today');
  if (p === 'tomorrow') return days(addDays(today, 1), 1, 'Tomorrow');
  if (p === 'yesterday') return days(addDays(today, -1), 1, 'Yesterday');
  const weekStart = startOfWeek(today, prefs.weekStartsOn);
  if (p === 'this week') return days(weekStart, 7, 'This week');
  if (p === 'next week') return days(addDays(weekStart, 7), 7, 'Next week');
  if (p === 'last week') return days(addDays(weekStart, -7), 7, 'Last week');
  if (/^(this )?weekend$/.test(p)) {
    const wd = weekdayOf(today);
    const sat = wd === 0 ? addDays(today, -1) : addDays(today, (6 - wd + 7) % 7);
    return days(sat, 2, 'This weekend');
  }
  const nextN = /^(?:the )?next (\d{1,2}) days$/.exec(p);
  if (nextN) return finish(days(today, Number(nextN[1])));

  // "<day> morning/afternoon/evening" windows (FR-423).
  const part = /^(?:(today|tomorrow|this|[a-z]+day)\s+)?(morning|afternoon|evening)$/.exec(p);
  if (part) {
    let date = today;
    if (part[1] && part[1] !== 'this' && part[1] !== 'today') {
      const r = resolveDatePhrase({ phrase: part[1], now, prefs, purpose: 'range' });
      if (r.status !== 'resolved') return r.status === 'past' ? { status: 'unparseable' } : r;
      date = r.localDate;
    }
    const [from, to] =
      part[2] === 'morning'
        ? [prefs.workdayStartsAt ?? DEFAULT_WORKDAY_START, '12:00']
        : part[2] === 'afternoon'
          ? ['12:00', '18:00']
          : ['17:00', '21:00'];
    const s = hhmm(from);
    const e = hhmm(to);
    const start = atWall(date, s.hour, s.minute, tz).instant;
    const end = atWall(date, e.hour, e.minute, tz).instant;
    return { status: 'resolved', start, end, startDate: date, endDate: addDays(date, 1), label: `${dateLabel(date, now, tz)} ${part[2]}` };
  }

  // Explicit "from X to Y" / "X to Y" / "between X and Y".
  const span = /^(?:from |between )?(.+?) (?:to|until|through|and|-) (.+)$/.exec(p);
  if (span) {
    const a = resolveDatePhrase({ phrase: span[1], now, prefs, purpose: 'range' });
    const b = resolveDatePhrase({ phrase: span[2], now, prefs, purpose: 'range' });
    if (a.status === 'resolved' && b.status === 'resolved' && b.localDate >= a.localDate) {
      return finish({
        status: 'resolved',
        start: startOfLocalDay(a.localDate, tz),
        end: startOfLocalDay(addDays(b.localDate, 1), tz),
        startDate: a.localDate,
        endDate: addDays(b.localDate, 1),
        label: `${a.label} – ${dateLabel(b.localDate, now, tz)}`,
      });
    }
  }

  const single = resolveDatePhrase({ phrase: p, now, prefs, purpose: 'range' });
  if (single.status === 'resolved') return days(single.localDate, 1);
  if (single.status === 'past') return { status: 'unparseable' };
  return single;
}
