/*
 * Fig 2 model: a typed word resolves to one exact date, the same way every
 * time (docs/00-product-spec.md, quick capture and the command bar; ADR-008).
 * Today is Wednesday 21 October 2026 and the word is "tomorrow", so the stamp
 * rolls its day band from 21 to 22 and prints 22 OCT 2026: Thursday.
 */
import { CARD_OUT, PRESS } from "./view";

export const WORD = "tomorrow";
export const TODAY = Date.UTC(2026, 9, 21);
const DAY_MS = 86_400_000;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/* The relative words this figure knows, as whole-day offsets. */
const OFFSETS: Record<string, number> = { today: 0, tomorrow: 1, "day after tomorrow": 2 };

export function resolve(word: string, today: number) {
  const offset = OFFSETS[word.trim().toLowerCase()];
  if (offset === undefined) return null;
  return today + offset * DAY_MS;
}

export const TARGET = resolve(WORD, TODAY)!;

export interface Stamp {
  day: number;
  month: number;
  year: number;
}

export const stampOf = (at: number): Stamp => {
  const date = new Date(at);
  return { day: date.getUTCDate(), month: date.getUTCMonth(), year: date.getUTCFullYear() };
};

export const monthName = (month: number) => MONTHS[((month % 12) + 12) % 12]!;
export const printed = (at: number) => {
  const { day, month, year } = stampOf(at);
  return `${String(day).padStart(2, "0")} ${monthName(month)} ${year}`;
};
export const spoken = (at: number) => {
  const date = new Date(at);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${monthName(date.getUTCMonth()).charAt(0)}${monthName(date.getUTCMonth()).slice(1).toLowerCase()}`;
};

/* timeline, in seconds */
export const ROLL: [number, number] = [0.5, 1.5];
export const DOWN: [number, number] = [1.8, 2.2];
export const UP: [number, number] = [2.45, 2.95];
export const SLIDE: [number, number] = [3.2, 4.2];
export const END = 4.4;
export const STOPS = [ROLL[1], DOWN[1], UP[1], END];

export const smooth = (from: number, to: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
};

const FROM = stampOf(TODAY);
const TO = stampOf(TARGET);

/* Continuous band positions; each band rolls only if its value changes. */
export function bandsAt(t: number): Stamp {
  const k = smooth(ROLL[0], ROLL[1], t);
  return {
    day: FROM.day + (TO.day - FROM.day) * k,
    month: FROM.month + (TO.month - FROM.month) * k,
    year: FROM.year + (TO.year - FROM.year) * k,
  };
}

/* How far the carriage has come down, 0..PRESS. The bands touch the card at
   the end of DOWN and stay there until UP starts. */
export const dropAt = (t: number) => PRESS * (smooth(DOWN[0], DOWN[1], t) - smooth(UP[0], UP[1], t));
export const inkedAt = (t: number) => t >= DOWN[1];
export const cardAt = (t: number) => CARD_OUT * smooth(SLIDE[0], SLIDE[1], t);

export const readoutOf = (t: number) => (t < ROLL[1] ? `today · ${spoken(TODAY)}` : `"${WORD}" → ${spoken(TARGET)}`);

export function spokenOf(t: number) {
  if (t < ROLL[1]) return `Today is ${spoken(TODAY)}. The stamp is set to ${printed(TODAY)}.`;
  if (!inkedAt(t)) return `"${WORD}" resolves to ${spoken(TARGET)}. The stamp is set to ${printed(TARGET)}.`;
  return `"${WORD}" resolved to ${spoken(TARGET)}; the card is stamped ${printed(TARGET)}.`;
}

/* The slider value: how many of the four steps (rolled, pressed, lifted, slid out) are done. */
export const stageOf = (t: number) => STOPS.filter((stop) => t >= stop - 1e-6).length;
