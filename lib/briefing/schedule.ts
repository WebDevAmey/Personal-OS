// lib/briefing/schedule.ts — pure "is this user's briefing due?" rule
// (ADR-010, BRIEF-001). Wall-clock comparison in the user's zone via
// lib/time, so DST days (23/25 h) and half-hour zones need no special case:
// a briefing time inside a spring-forward gap fires at the first tick after
// the gap; a fall-back repeat fires once because the run row then exists.
import { isValidTimeZone, localDateOf, zonedParts, type LocalDate } from '@/lib/time';

export interface ScheduleInput {
  timeZone: string;
  briefingHour: number;
  briefingMinute: number;
}

export interface DueResult {
  due: boolean;
  localDate: LocalDate;
}

/** Falls back to UTC for a zone the runtime does not know (never throws for one bad row). */
export function safeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

export function briefingDue(now: Date, pref: ScheduleInput): DueResult {
  const tz = safeZone(pref.timeZone);
  const p = zonedParts(now, tz);
  const minutesNow = p.hour * 60 + p.minute;
  const target = pref.briefingHour * 60 + pref.briefingMinute;
  return { due: minutesNow >= target, localDate: localDateOf(now, tz) };
}
