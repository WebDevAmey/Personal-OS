/*
 * Fig 1 model: the morning briefing as a sorting desk.
 *
 * Product truth (docs/00-product-spec.md, FR-301..FR-305): at the user's
 * briefing hour (06:30 by default) the briefing reads tasks, Gmail and
 * Calendar, and at most 7 items reach "Needs attention". Here 43 items come
 * in and 6 need you; the rest go to Later. Every pose, count and the readout
 * come from this module, on the server (the still) and in the browser (the
 * live figure).
 */
import {
  BELT_HALF,
  BELT_TOP,
  BELT_X1,
  BIN,
  BIN_FLOOR,
  CARD_D,
  CARD_W,
  GATE_LEN,
  GATE_OPEN,
  GATE_X,
  GATE_Y,
  HOPPER_X,
  PILE,
  PILE_EACH,
  SEAT_PITCH,
  SEAT_X0,
  SEATS,
  SHELF_TOP,
  SHELF_Y,
} from "./view";

export type Kind = "mail" | "task" | "event";

export interface Item {
  kind: Kind;
  need: boolean;
}

export const BRIEFING_AT = "06:30";
export const MOST_TODAY = 7;

/* 43 items in arrival order: 27 emails, 10 tasks, 6 events; 6 need you. */
const PATTERN = "mmtmemmtmmemtmmmtmmemmtmmmemtmmmtmmemmtmmtm";
const NEEDS = new Set([4, 11, 18, 25, 31, 37]);

export const ITEMS: Item[] = PATTERN.split("").map((letter, index) => ({
  kind: letter === "m" ? "mail" : letter === "t" ? "task" : "event",
  need: NEEDS.has(index),
}));

export const TOTAL = ITEMS.length;
export const NEED_TOTAL = ITEMS.filter((item) => item.need).length;

/* motion constants */
export const SPEED = 90;
const PITCH = 0.27;
const GRAVITY = 320;
const SLIDE = 0.12;
const SETTLE = 0.26;
const OPEN_FOR = 0.3;
const CLOSE_FOR = 0.3;
const EASE_LAST = 26;
const CORNER = 9;

/* Diverted path: along the belt to first contact with the paddle, then along
   the paddle at 45°, out through the outlet, onto the shelf, then left to the
   next free seat. The card's far corner rides the paddle face, which puts the
   card centre on y = x + DIAG. */
const DIAG = -GATE_X + GATE_Y + CARD_D / 2 + CARD_W / 2;
const CONTACT_X = -DIAG;
const TURN_X = SHELF_Y - DIAG;
export const seatX = (seat: number) => SEAT_X0 + seat * SEAT_PITCH;

/* The paddle sweeps x in [GATE_X, GATE_X + GATE_LEN]. The card ahead must be
   past that when the gate starts to open, and the card behind must still be
   short of the pin when it has closed again. */
const CLEAR = 3;
const LEAD = (GATE_X + GATE_LEN + CARD_W / 2 + CLEAR - CONTACT_X) / SPEED + OPEN_FOR + 0.05;
const LEAVE_S = Math.SQRT2 * (GATE_X + GATE_LEN * Math.SQRT1_2 - CARD_W / 2 - CONTACT_X);
const TRAIL = (CONTACT_X + CARD_W / 2 - GATE_X + CLEAR) / SPEED + LEAVE_S / SPEED + CLOSE_FOR;

export const START = 0.4;

export const RELEASES: number[] = (() => {
  const out: number[] = [];
  let at = START;
  ITEMS.forEach((item, index) => {
    if (index > 0) {
      const before = ITEMS[index - 1]!;
      let gap = PITCH;
      if (item.need) gap = Math.max(gap, LEAD);
      if (before.need) gap = Math.max(gap, TRAIL);
      at += gap;
    }
    out.push(at);
  });
  return out;
})();

const ORIGIN_X = HOPPER_X;
const toContact = (CONTACT_X - ORIGIN_X) / SPEED;
const toEnd = (BELT_X1 - ORIGIN_X) / SPEED;

export const seatOf: number[] = (() => {
  let seat = 0;
  return ITEMS.map((item) => (item.need ? seat++ : -1));
})();

/* Polyline with rounded corners, sampled once per diverted seat. */
type P2 = [number, number];

function rounded(points: P2[], radius: number): P2[] {
  const out: P2[] = [points[0]!];
  for (let index = 1; index < points.length - 1; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const c = points[index + 1]!;
    const inLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const outLen = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(radius, inLen * 0.45, outLen * 0.45);
    const p: P2 = [b[0] + ((a[0] - b[0]) / inLen) * r, b[1] + ((a[1] - b[1]) / inLen) * r];
    const q: P2 = [b[0] + ((c[0] - b[0]) / outLen) * r, b[1] + ((c[1] - b[1]) / outLen) * r];
    for (let step = 0; step <= 8; step++) {
      const t = step / 8;
      const u = 1 - t;
      out.push([u * u * p[0] + 2 * u * t * b[0] + t * t * q[0], u * u * p[1] + 2 * u * t * b[1] + t * t * q[1]]);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

interface Track {
  points: P2[];
  lengths: number[];
  total: number;
}

function trackOf(points: P2[]): Track {
  const lengths = [0];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    lengths.push(lengths[index - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { points, lengths, total: lengths[lengths.length - 1]! };
}

function along(track: Track, s: number): P2 {
  const { points, lengths } = track;
  if (s <= 0) return points[0]!;
  if (s >= track.total) return points[points.length - 1]!;
  let index = 1;
  while (lengths[index]! < s) index++;
  const a = points[index - 1]!;
  const b = points[index]!;
  const t = (s - lengths[index - 1]!) / (lengths[index]! - lengths[index - 1]! || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

const TRACKS: Track[] = Array.from({ length: MOST_TODAY }, (_, seat) =>
  trackOf(
    rounded(
      [
        [ORIGIN_X, 0],
        [CONTACT_X, 0],
        [TURN_X, SHELF_Y],
        [seatX(seat), SHELF_Y],
      ],
      CORNER,
    ),
  ),
);

/* Distance travelled: constant speed, then an even stop over the last
   EASE_LAST units, as a card sliding to rest against the one before it. */
function travelled(total: number, age: number) {
  const cruise = Math.max(0, total - EASE_LAST);
  const cruiseFor = cruise / SPEED;
  if (age <= cruiseFor) return SPEED * age;
  const stopFor = (2 * EASE_LAST) / SPEED;
  const u = Math.min(1, (age - cruiseFor) / stopFor);
  return cruise + EASE_LAST * (1 - (1 - u) * (1 - u));
}

const arriveFor = (total: number) => Math.max(0, total - EASE_LAST) / SPEED + (2 * EASE_LAST) / SPEED;

export const smooth = (edge0: number, edge1: number, value: number) => {
  const u = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return u * u * (3 - 2 * u);
};

/* Where each straight card lands in the bin, from free flight off the belt
   end, then a short slide across the pile. */
interface Landing {
  at: number;
  x: number;
  z: number;
  flight: number;
  rest: number;
}

export const LANDINGS: (Landing | null)[] = (() => {
  let count = 0;
  return ITEMS.map((item, index) => {
    if (item.need) return null;
    const top = BIN_FLOOR + count * PILE_EACH;
    const fall = BELT_TOP - top;
    const flight = Math.sqrt((2 * fall) / GRAVITY);
    const x = BELT_X1 + SPEED * flight;
    const rest = Math.min(x + SPEED * SLIDE, PILE.x + PILE.w - CARD_W / 2 - 2);
    count++;
    return { at: RELEASES[index]! + toEnd + flight, x, z: top, flight, rest };
  });
})();

export type Layer = "belt" | "out" | "bin";

export interface Pose {
  index: number;
  kind: Kind;
  layer: Layer;
  x: number;
  y: number;
  z: number;
  alpha: number;
  lit: boolean;
  need: boolean;
}

export function poseOf(index: number, t: number): Pose | null {
  const item = ITEMS[index]!;
  const age = t - RELEASES[index]!;
  if (age < 0) return null;
  const base = { index, kind: item.kind, need: item.need, alpha: 1 };
  if (item.need) {
    const track = TRACKS[seatOf[index]!]!;
    const s = travelled(track.total, age);
    const [x, y] = along(track, s);
    const drop = smooth(BELT_HALF + 22, SHELF_Y - 2, y);
    const z = BELT_TOP + (SHELF_TOP - BELT_TOP) * drop;
    const layer: Layer = y + CARD_D / 2 > BELT_HALF ? "out" : "belt";
    const resting = age >= arriveFor(track.total);
    return { ...base, layer, x, y, z, lit: !resting };
  }
  const landing = LANDINGS[index]!;
  if (age <= toEnd) return { ...base, layer: "belt", x: ORIGIN_X + SPEED * age, y: 0, z: BELT_TOP, lit: false };
  const flown = age - toEnd;
  if (flown <= landing.flight) {
    return { ...base, layer: "bin", x: BELT_X1 + SPEED * flown, y: 0, z: BELT_TOP - 0.5 * GRAVITY * flown * flown, lit: false };
  }
  const since = flown - landing.flight;
  const slide = 1 - Math.exp(-since / SLIDE);
  const x = landing.x + (landing.rest - landing.x) * slide;
  const alpha = 1 - smooth(0.12, 0.12 + SETTLE, since);
  if (alpha <= 0) return null;
  return { ...base, layer: "bin", x, y: 0, z: landing.z, alpha, lit: false };
}

/* Gate angle in degrees: opens before a card that needs you reaches it and
   closes once that card has left the paddle. */
export function gateAt(t: number) {
  let open = 0;
  ITEMS.forEach((item, index) => {
    if (!item.need) return;
    const contact = RELEASES[index]! + toContact;
    const leave = contact + LEAVE_S / SPEED;
    const rise = smooth(contact - OPEN_FOR - 0.05, contact - 0.05, t);
    const fall = 1 - smooth(leave, leave + CLOSE_FOR, t);
    open = Math.max(open, Math.min(rise, fall));
  });
  return open * GATE_OPEN;
}

/* A card is counted "in" once the gate has decided it: it reached the gate
   line, and counted as needing you at the same instant. */
const DECIDED = (CONTACT_X - ORIGIN_X) / SPEED;

/* The moment each card is decided, used as keyboard stops. */
export const DECIDED_AT = RELEASES.map((at) => at + DECIDED);

export function countsAt(t: number) {
  let seen = 0;
  let need = 0;
  let released = 0;
  let pile = 0;
  ITEMS.forEach((item, index) => {
    const age = t - RELEASES[index]!;
    if (age >= 0) released++;
    if (age >= DECIDED) {
      seen++;
      if (item.need) need++;
    }
    const landing = LANDINGS[index];
    if (landing) pile += smooth(landing.at + 0.12, landing.at + 0.12 + SETTLE, t);
  });
  return { seen, need, stack: TOTAL - released, pile };
}

export const END = (() => {
  let last = 0;
  ITEMS.forEach((item, index) => {
    const finish = item.need
      ? RELEASES[index]! + arriveFor(TRACKS[seatOf[index]!]!.total)
      : LANDINGS[index]!.at + 0.12 + SETTLE + 0.05;
    last = Math.max(last, finish);
  });
  return last;
})();

export const readoutOf = (t: number) => {
  const { seen, need } = countsAt(t);
  return `${BRIEFING_AT} · ${seen} in → ${need} need you`;
};

export function spokenOf(t: number) {
  const { seen, need } = countsAt(t);
  if (seen === 0) return `Briefing at ${BRIEFING_AT}: nothing sorted yet, ${TOTAL} items waiting in the intake tray.`;
  if (seen === TOTAL) return `Briefing at ${BRIEFING_AT}: ${TOTAL} items read, ${need} need you today, the rest are filed for later.`;
  return `Sorting: ${seen} of ${TOTAL} items read, ${need} need you so far.`;
}

export const SEAT_COUNT = SEATS;
export const BIN_PLAN = BIN;
export const GATE_PIVOT: P2 = [GATE_X, GATE_Y];
