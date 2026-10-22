import { corners, cylinder, insetPlan, iso, planOutline, slabOf, topMatrix, type Plan } from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import {
  BEZEL,
  BEZEL_H,
  BEZEL_TOP,
  FOOT_H,
  HINGE,
  HINGE_R,
  HOOD_W,
  LAMP,
  LAMP_R,
  LENS_R,
  NUT_H,
  NUT_R,
  P,
  PANEL,
  PANEL_H,
  PIVOT,
  SWITCH_X,
  TOP,
  UNDO,
  UNDO_R,
} from "./view";

/* Fig 3, static parts. The cover and the bat move; see motion.ts. */

const slab = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const top = (x: number, y: number, z = TOP) => topMatrix([x, y], z, P, "x");

export const PANEL_ART = {
  halo: slab({ ...PANEL, x: PANEL.x + 2, y: PANEL.y + 2 }, 0, TOP, 8).fill,
  feet: corners(PANEL, 6).map(([x, y]) => cylinder(x, y, 3, 0, FOOT_H, P, 24)),
  body: slab(PANEL, FOOT_H, PANEL_H, 8, 0.8),
  inset: planOutline(insetPlan(PANEL, 3), TOP, P),
  screws: corners(PANEL, 6).map(([x, y]) => iso([x, y, TOP], P)),
};

export const BEZEL_ART = {
  plate: slab(BEZEL, TOP, BEZEL_H, 4, 0.4),
  screws: corners(BEZEL, 2.2).map(([x, y]) => iso([x, y, BEZEL_TOP], P)),
  label: top(SWITCH_X, BEZEL.y + BEZEL.d + 3.6),
};

/* hinge: two blocks carry the barrel the cover turns on */
const KNUCKLE_X = HOOD_W + 0.6;
export const HINGE_ART = {
  blocks: [-1, 1].map((side) => slab({ x: SWITCH_X + side * KNUCKLE_X - (side < 0 ? 2.6 : 0), y: HINGE[1] - 1.4, w: 2.6, d: 2.8, r: 0.4 }, BEZEL_TOP, HINGE_R, 2)),
  barrel: G.disc(0, (KNUCKLE_X + 2.6) * 2, HINGE_R, G.frameOf([SWITCH_X - KNUCKLE_X - 2.6, HINGE[1], HINGE[2]], [1, 0, 0], [0, 1, 0], [0, 0, 1]), P),
};

/* parts of the bat that do not change as it tilts */
export const NUT_ART = {
  nut: cylinder(PIVOT[0], PIVOT[1], NUT_R, BEZEL_TOP, NUT_H, P, 6, 0),
  ball: G.sphereOf(PIVOT, 1.9, P),
};

export const LAMP_ART = {
  ring: cylinder(LAMP[0], LAMP[1], LAMP_R, TOP, 1.6, P, 40),
  lens: cylinder(LAMP[0], LAMP[1], LENS_R, TOP + 1.6, 1.1, P, 40, 0.5),
  label: top(LAMP[0], LAMP[1] + LAMP_R + 4),
};

export const UNDO_ART = {
  base: cylinder(UNDO[0], UNDO[1], UNDO_R, TOP, 1.1, P, 32),
  cap: cylinder(UNDO[0], UNDO[1], UNDO_R - 0.9, TOP + 1.1, 1.3, P, 32, 0.4),
  label: top(UNDO[0], UNDO[1] + UNDO_R + 4),
};

/* the command plate: what is waiting, and why it is guarded */
const CLASS_AT = [0, 7.6, 22.6];
export const PLATE: Plan = { x: -35, y: 9, w: 37, d: 15.4, r: 1 };
export const PLATE_ART = {
  body: slab(PLATE, TOP, 0.5, 3),
  line1: top(PLATE.x + 2, PLATE.y + 4.6, TOP + 0.5),
  line2: top(PLATE.x + 2, PLATE.y + 8.6, TOP + 0.5),
  classes: CLASS_AT.map((at) => top(PLATE.x + 4 + at, PLATE.y + 14, TOP + 0.5)),
  marks: CLASS_AT.map((at) => iso([PLATE.x + 2.7 + at, PLATE.y + 13.4, TOP + 0.5], P)),
};
