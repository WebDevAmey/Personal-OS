// components/tasks/capture.ts — deterministic quick-capture parser (FR-210..212).
// Pure and shared: the capture field uses it for the live chip preview and
// POST /api/tasks uses it to create the task, so what the user sees is what
// is saved. No model call is ever involved.
//
// Syntax: `Book dentist next Tue 3pm #health !2 @errands`
//   !1–!4   priority (!1 = Urgent … !4 = Low)
//   #name   project (existing project, case-insensitive; one word or #"two words")
//   @tag    tag (lower-cased)
//   dates   today · tonight · tomorrow · mon…sun · next <weekday> · in N days ·
//           next week · YYYY-MM-DD, optionally followed by a time (3pm, 15:30, at 9)
//
// The date vocabulary is a deliberate subset; ADR-008 moves the server-side
// resolver to chrono-node, at which point this parser should call the same
// resolver for parity.
import { addDays, weekdayOf, isLocalDate, type LocalDate } from '@/lib/time';

export interface CaptureToken {
  kind: 'date' | 'project' | 'priority' | 'tag';
  text: string;
  label: string;
}

export interface ParsedCapture {
  title: string;
  due: { date: LocalDate; time: string | null } | null;
  projectName: string | null;
  priority: number | null;
  tags: string[];
  tokens: CaptureToken[];
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PRIORITY_FROM_BANG: Record<string, number> = { '1': 4, '2': 3, '3': 2, '4': 1 };
const PRIORITY_NAMES: Record<number, string> = { 4: 'Urgent', 3: 'High', 2: 'Medium', 1: 'Low' };

export function formatShortDate(date: LocalDate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${DAY_NAMES[weekdayOf(date)]} ${d} ${MONTHS[m - 1]}`;
}

function nextWeekday(today: LocalDate, weekday: number): LocalDate {
  const delta = ((weekday - weekdayOf(today) + 7) % 7) || 7;
  return addDays(today, delta);
}

const TIME_RE = /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

function parseTime(raw: string): string | null {
  const m = TIME_RE.exec(raw.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? '0');
  const meridiem = m[3]?.toLowerCase();
  // A bare number is only a time when it is clearly one ("at 9", "9:30").
  if (!meridiem && m[2] === undefined && !/^at\s/i.test(raw.trim())) return null;
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

interface DateMatch {
  start: number;
  end: number;
  date: LocalDate;
  time: string | null;
}

/** Finds the first date phrase (plus an optional trailing time) in `text`. */
function findDate(text: string, today: LocalDate): DateMatch | null {
  const patterns: { re: RegExp; resolve: (m: RegExpExecArray) => { date: LocalDate; time: string | null } | null }[] = [
    { re: /\b(\d{4}-\d{2}-\d{2})\b/i, resolve: (m) => (isLocalDate(m[1]) ? { date: m[1], time: null } : null) },
    { re: /\btoday\b/i, resolve: () => ({ date: today, time: null }) },
    { re: /\btonight\b/i, resolve: () => ({ date: today, time: '19:00' }) },
    { re: /\b(tomorrow|tmrw?|tmr)\b/i, resolve: () => ({ date: addDays(today, 1), time: null }) },
    { re: /\bin\s+(\d{1,3})\s+days?\b/i, resolve: (m) => ({ date: addDays(today, Number(m[1])), time: null }) },
    { re: /\bnext\s+week\b/i, resolve: () => ({ date: nextWeekday(today, 1), time: null }) },
    {
      re: /\b(?:(?:next|on|this)\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i,
      resolve: (m) => ({ date: nextWeekday(today, WEEKDAYS[m[1].toLowerCase()]), time: null }),
    },
  ];
  let best: DateMatch | null = null;
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const r = p.resolve(m);
    if (!r) continue;
    if (!best || m.index < best.start) best = { start: m.index, end: m.index + m[0].length, ...r };
  }
  if (!best) return null;
  const rest = text.slice(best.end);
  const timeMatch = /^\s+((?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i.exec(rest);
  if (timeMatch) {
    const time = parseTime(timeMatch[1]);
    if (time) {
      best.time = time;
      best.end += timeMatch[0].length;
    }
  }
  return best;
}

export function parseCapture(input: string, today: LocalDate): ParsedCapture {
  let text = input.replace(/^\s*\+\s*/, '');
  const tokens: CaptureToken[] = [];
  let priority: number | null = null;
  let projectName: string | null = null;
  const tags: string[] = [];

  text = text.replace(/(^|\s)!([1-4])(?=\s|$)/g, (all, lead: string, n: string) => {
    if (priority === null) {
      priority = PRIORITY_FROM_BANG[n];
      tokens.push({ kind: 'priority', text: `!${n}`, label: PRIORITY_NAMES[priority] });
    }
    return lead;
  });
  text = text.replace(/(^|\s)#(?:"([^"]{1,100})"|([\p{L}\p{N}_-]{1,100}))/gu, (all, lead: string, quoted?: string, word?: string) => {
    if (projectName === null) {
      projectName = (quoted ?? word ?? '').trim();
      tokens.push({ kind: 'project', text: all.trim(), label: projectName });
    }
    return lead;
  });
  text = text.replace(/(^|\s)@([\p{L}\p{N}_-]{1,32})/gu, (all, lead: string, tag: string) => {
    const t = tag.toLowerCase();
    if (!tags.includes(t) && tags.length < 10) {
      tags.push(t);
      tokens.push({ kind: 'tag', text: `@${tag}`, label: t });
    }
    return lead;
  });

  let due: ParsedCapture['due'] = null;
  const match = findDate(text, today);
  if (match) {
    due = { date: match.date, time: match.time };
    tokens.push({ kind: 'date', text: text.slice(match.start, match.end).trim(), label: `${formatShortDate(match.date)}${match.time ? ` ${match.time}` : ''}` });
    text = `${text.slice(0, match.start)} ${text.slice(match.end)}`;
  }

  const title = text.replace(/\s+/g, ' ').trim();
  return { title, due, projectName, priority, tags, tokens };
}
