/*
 * Fig 3 model: nothing risky happens without you (docs/00-product-spec.md,
 * confirmation classes and example E6). "Postpone everything due today to
 * Monday" changes four existing tasks, which makes it BULK, so it waits
 * behind a guard: lift the cover, flip the switch, and the lamp shows it
 * applied. Every change can be undone, so the tour flips it
 * back and closes the cover again.
 */
import { BAT_OFF, BAT_ON, COVER_OPEN } from "./view";

export type ActionClass = "BULK" | "DESTRUCTIVE" | "EXTERNAL";
export const CLASSES: ActionClass[] = ["BULK", "DESTRUCTIVE", "EXTERNAL"];

/* BULK: one command that modifies more than one existing item. */
export const CHANGES = 4;
export const COMMAND = "Postpone everything due today to Monday";

export function classesOf(action: { modifies: number; deletes?: boolean; external?: boolean }): ActionClass[] {
  const out: ActionClass[] = [];
  if (action.modifies > 1) out.push("BULK");
  if (action.deletes) out.push("DESTRUCTIVE");
  if (action.external) out.push("EXTERNAL");
  return out;
}

export const ACTION = { modifies: CHANGES, deletes: false, external: false };
export const NEEDS_CONFIRM = classesOf(ACTION).length > 0;

/* timeline, in seconds; the end state equals the start state */
export const OPEN: [number, number] = [0.5, 1.2];
export const ON: [number, number] = [1.55, 1.8];
export const OFF: [number, number] = [3.7, 3.95];
export const CLOSE: [number, number] = [4.3, 5];
export const END = 5.3;
export const STOPS = [OPEN[1], ON[1], OFF[1], END];

export const smooth = (from: number, to: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
};

/* A toggle snaps over its centre: slow start, fast finish. */
const snap = (from: number, to: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * x;
};

export const coverAt = (t: number) => COVER_OPEN * (smooth(OPEN[0], OPEN[1], t) - smooth(CLOSE[0], CLOSE[1], t));
export const batAt = (t: number) => BAT_OFF + (BAT_ON - BAT_OFF) * (snap(ON[0], ON[1], t) - snap(OFF[0], OFF[1], t));
export const appliedAt = (t: number) => batAt(t) > 0;

export const readoutOf = (t: number) => (appliedAt(t) ? `${CHANGES} changes applied · Undo` : `${CHANGES} changes · confirm to apply`);

export function spokenOf(t: number) {
  if (appliedAt(t)) return `Confirmed. ${CHANGES} changes applied; Undo is available.`;
  if (coverAt(t) > COVER_OPEN / 2) return `Cover lifted. ${CHANGES} changes are waiting for you to confirm.`;
  return `${CHANGES} changes, a bulk action, wait behind the cover until you confirm.`;
}

export const stageOf = (t: number) => (t >= END - 1e-6 ? 0 : STOPS.filter((stop) => t >= stop - 1e-6).length);
