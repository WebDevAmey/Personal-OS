import {
  cylinder,
  insetPlan,
  iso,
  knurl,
  pathOf,
  planOutline,
  ring,
  slabOf,
  topMatrix,
  type Flat,
  type Plan,
  type SolidPaths,
} from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import {
  ARM_T,
  ARM_Y,
  AXLE_R,
  AXLE_Z,
  BAND_R,
  BANDS,
  BLOCK,
  BLOCK_H,
  BRIDGE,
  BRIDGE_H,
  CARD,
  CARD_T,
  CARD_TOP,
  CROSS,
  CROSS_H,
  CROSS_Z,
  FRAME_TOP,
  KNOB_H,
  KNOB_R,
  KNOB_Z,
  P,
  PAD,
  PAD_H,
  PLATE_IN,
  PLATE_T,
  PLATE_Y,
  PRESS,
  SLIP,
  SPACER_R,
  STEM_R,
  THUMB_R,
  THUMB_X0,
  THUMB_X1,
  TRACK_X,
  TRACK_Y0,
  TRACK_Y1,
} from "./view";

const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const along = (x: number) => G.frameOf([x, 0, AXLE_Z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const disc = (x0: number, x1: number, r: number): SolidPaths => G.disc(0, x1 - x0, r, along(x0), P);
const join = (paths: string[]) => paths.filter(Boolean).join("");

/* ---------- desk pad, track, desk calendar, slip ---------- */

export const PAD_ART = {
  halo: slab({ ...PAD, x: PAD.x + 2, y: PAD.y + 2 }, 0, PAD_H, 8).fill,
  slab: slab(PAD, 0, PAD_H, 8, 0.8),
  inset: planOutline(insetPlan(PAD, 4), PAD_H, P),
  tracks: [-1, 1].map((side) => slab({ x: side < 0 ? -TRACK_X - 1.2 : TRACK_X, y: TRACK_Y0, w: 1.2, d: TRACK_Y1 - TRACK_Y0, r: 0.4 }, PAD_H, 1.2, 2)),
};

const top = (x: number, y: number, z: number) => topMatrix([x, y], z, P, "x");

export const BLOCK_ART = {
  body: slab(BLOCK, PAD_H, BLOCK_H, 4),
  sheet: planOutline(insetPlan({ ...BLOCK, y: BLOCK.y + 5, d: BLOCK.d - 5 }, 1.4), PAD_H + BLOCK_H, P),
  binding: slab({ x: BLOCK.x + 1, y: BLOCK.y + 0.8, w: BLOCK.w - 2, d: 3.4, r: 1 }, PAD_H + BLOCK_H, 1.4, 4),
  rings: [0.2, 0.4, 0.6, 0.8].map((k) => iso([BLOCK.x + BLOCK.w * k, BLOCK.y + 2.5, PAD_H + BLOCK_H + 1.4], P)),
  weekday: top(BLOCK.x + BLOCK.w / 2, BLOCK.y + 10, PAD_H + BLOCK_H),
  day: top(BLOCK.x + BLOCK.w / 2, BLOCK.y + 20, PAD_H + BLOCK_H),
  month: top(BLOCK.x + BLOCK.w / 2, BLOCK.y + 23.4, PAD_H + BLOCK_H),
};

export const SLIP_ART = {
  body: slab(SLIP, PAD_H, 0.4, 2),
  label: top(SLIP.x + 2.4, SLIP.y + 4.2, PAD_H + 0.4),
  word: top(SLIP.x + 2.4, SLIP.y + 9.6, PAD_H + 0.4),
};

/* ---------- the index card (drawn at rest; the live code slides it) ---------- */

const ON_CARD = CARD_TOP;
export const BOX: Plan = { x: -18.6, y: -3.4, w: 37.2, d: 6.8, r: 0.6 };

export const CARD_ART = {
  body: slab(CARD, PAD_H, CARD_T, 3),
  title: top(CARD.x + 1.6, CARD.y + 4.6, ON_CARD),
  label: top(BOX.x, BOX.y - 1, ON_CARD),
  box: planOutline(BOX, ON_CARD, P, 3),
  rules: join([6.2, 8.6, 11].map((y) => pathOf([iso([CARD.x + 1.6, y, ON_CARD], P), iso([CARD.x + CARD.w - 1.6, y, ON_CARD], P)]))),
};

/* The imprint: one mark per band, centred on where that band meets the card. */
export const IMPRINT = BANDS.map((band) => top((band.x0 + band.x1) / 2, 0.95, ON_CARD));

/* ---------- outer frame ---------- */

const plate = (x: number): Plan => ({ x, y: -PLATE_Y, w: PLATE_T, d: PLATE_Y * 2, r: 0.6 });
const OUTER = PLATE_IN + PLATE_T;

/* The slot in the near plate that the axle rides in. */
function slotPath() {
  const r = AXLE_R + 0.5;
  const points: Flat[] = [];
  for (let step = 0; step <= 16; step++) {
    const a = (step / 16) * Math.PI;
    points.push(iso([OUTER, r * Math.cos(a), AXLE_Z + r * Math.sin(a)], P));
  }
  for (let step = 0; step <= 16; step++) {
    const a = Math.PI + (step / 16) * Math.PI;
    points.push(iso([OUTER, r * Math.cos(a), AXLE_Z - PRESS + r * Math.sin(a)], P));
  }
  return pathOf(points, true);
}

export const FRAME_ART = {
  far: slab(plate(-OUTER), PAD_H, FRAME_TOP - PAD_H, 2),
  near: slab(plate(PLATE_IN), PAD_H, FRAME_TOP - PAD_H, 2),
  slot: slotPath(),
  nearScrews: [-PLATE_Y + 3, PLATE_Y - 3].flatMap((y) => [iso([OUTER, y, PAD_H + 6], P), iso([OUTER, y, FRAME_TOP - 5], P)]),
  bridge: slab(BRIDGE, FRAME_TOP, BRIDGE_H, 4, 0.5),
  bore: ring(0, 0, STEM_R + 0.7, FRAME_TOP + BRIDGE_H, P, 28),
  bridgeScrews: [-1, 1].flatMap((side) => [-5, 5].map((y) => iso([side * (OUTER - PLATE_T / 2), y, FRAME_TOP + BRIDGE_H], P))),
};

/* ---------- carriage (drawn at rest; the live code drops it) ---------- */

const arm = (x: number): Plan => ({ x, y: -ARM_Y, w: ARM_T, d: ARM_Y * 2, r: 0.4 });
const ARM_X = PLATE_IN - 0.4 - ARM_T;

export const CARRIAGE_ART = {
  farArm: slab(arm(-ARM_X - ARM_T), AXLE_Z - 3.6, CROSS_Z - AXLE_Z + 3.6, 2),
  nearArm: slab(arm(ARM_X), AXLE_Z - 3.6, CROSS_Z - AXLE_Z + 3.6, 2),
  farAxle: disc(-ARM_X, BANDS[0].x0, AXLE_R),
  nearAxle: disc(BANDS[2].x1, ARM_X, AXLE_R),
  bands: BANDS.map((band) => disc(band.x0, band.x1, BAND_R)),
  spacers: BANDS.slice(1).map((band, index) => disc(BANDS[index]!.x1, band.x0, SPACER_R)),
  cross: slab(CROSS, CROSS_Z, CROSS_H, 3),
  crossScrews: [-1, 1].map((side) => iso([side * (ARM_X + ARM_T / 2), 0, CROSS_Z + CROSS_H], P)),
};

export const KNOB_ART = {
  collar: cylinder(0, 0, STEM_R + 1.2, KNOB_Z - 1.6, 1.6, P, 24),
  knob: cylinder(0, 0, KNOB_R, KNOB_Z, KNOB_H, P, 48, 0.6),
  knurl: knurl(0, 0, KNOB_R, KNOB_Z + 0.6, KNOB_Z + KNOB_H - 0.6, 40, P),
  cap: ring(0, 0, KNOB_R - 2.4, KNOB_Z + KNOB_H, P, 40),
};

export const THUMB_ART = {
  stub: disc(OUTER, THUMB_X0, AXLE_R),
  wheel: disc(THUMB_X0, THUMB_X1, THUMB_R),
  hub: disc(THUMB_X1, THUMB_X1 + 1, AXLE_R + 1),
};
