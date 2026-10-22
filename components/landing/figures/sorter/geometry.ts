import {
  circleRing,
  corners,
  depthOf,
  extrude,
  insetPlan,
  knurl,
  onTop,
  pathOf,
  planOutline,
  radialTicks,
  ring,
  segment,
  sideArc,
  sideRing,
  sideSeam,
  slabOf,
  topTicks,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
  type SolidPaths,
} from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import {
  BASE,
  BASE_H,
  BELT_HALF,
  BELT_TOP,
  BELT_UNDER,
  BELT_X0,
  BELT_X1,
  BIN,
  BIN_FLOOR,
  BIN_H,
  BIN_LIP,
  BIN_WALL,
  CARD_D,
  CARD_T,
  CARD_W,
  FOOT_H,
  GAP_X0,
  GAP_X1,
  GATE_H,
  GATE_T,
  GATE_X,
  GATE_Y,
  GATE_Z,
  HOPPER_IN,
  HOPPER_TOP,
  HOPPER_WALL,
  LEGS_X,
  P,
  PLATE_TOP,
  RAIL_D,
  RAIL_TOP,
  RAIL_X0,
  RAIL_X1,
  RAIL_Z0,
  SEAT_PITCH,
  SEAT_X0,
  SEATS,
  SHELF,
  SHELF_TOP,
  THROAT,
  TIMER_AT,
  at,
} from "./view";

const solid = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const post = (x: number, y: number, r: number, z: number, h: number, steps = 24) => extrude(circleRing(x, y, r, steps), z, h, P, { convex: true });
const line = (a: Point3, b: Point3) => segment(a, b, P);
const join = (paths: string[]) => paths.filter(Boolean).join("");
const byDepth = <T extends { at: Point3 }>(list: T[]) => [...list].sort((a, b) => depthOf(a.at, P) - depthOf(b.at, P));

/* ---------- base plate on feet ---------- */

const FEET = byDepth(corners(BASE, 20).map(([x, y]) => ({ at: [x, y, 0] as Point3 })));
const SCREWS: Plane[] = corners(BASE, 8);
const LABEL: Plan = { x: 70, y: BASE.y + BASE.d - 14, w: 34, d: 8, r: 1.5 };

export const BASE_ART = {
  halo: slabOf(insetPlan(BASE, 4), -BASE_H - FOOT_H, BASE_H, P).fill,
  feet: FEET.map(({ at: [x, y] }) => [post(x, y, 7, -BASE_H - FOOT_H, 1.6, 28), post(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, 28)]),
  slab: solid(BASE, -BASE_H, BASE_H, 8, 1.6),
  groove: planOutline(insetPlan(BASE, 4.5), 0, P),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  screwRings: join(SCREWS.map(([x, y]) => ring(x, y, 2.2, 0, P, 16))),
  label: solid(LABEL, 0, 0.8, 3),
  labelLine: planOutline(insetPlan(LABEL, 1.4), 0.8, P),
  labelRule: join([0, 1].map((row) => onTop([[LABEL.x + 7, LABEL.y + 3 + row * 2.2], [LABEL.x + (row ? 26 : 36), LABEL.y + 3 + row * 2.2]], 0.8, P))),
  labelScrews: [at([LABEL.x + 3, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 3, LABEL.y + LABEL.d / 2, 0.8])],
};

/* ---------- the timer that starts the sort at the briefing hour ---------- */

const [TX, TY] = TIMER_AT;
const TR = 15;
const T_FOOT: Plan = { x: TX - TR - 4, y: TY - TR - 4, w: TR * 2 + 8, d: TR * 2 + 8, r: 5 };
const T_Z = 1.2;
const T_H = 7;
const T_TOP = T_Z + T_H;
const handOf = (turns: number, length: number, tail: number, width: number) => {
  const angle = turns * Math.PI * 2;
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const p = (along: number, across: number): Point3 => [TX + ux * along - uy * across, TY + uy * along + ux * across, T_TOP + 0.15];
  return pathOf([at(p(length, 0)), at(p(0, width)), at(p(-tail, width * 0.5)), at(p(-tail, -width * 0.5)), at(p(0, -width))], true);
};
const TIMER_TICKS = radialTicks(TX, TY, TR - 2.4, 60, 5, T_TOP, [1, 2.4], P);

export const TIMER_ART = {
  halo: slabOf(insetPlan(T_FOOT, 3), 0, 0.2, P).fill,
  foot: solid(T_FOOT, 0, T_Z, 6, 0.4),
  footScrews: corners(T_FOOT, 3.6).map(([x, y]) => at([x, y, T_Z])),
  puck: post(TX, TY, TR, T_Z, T_H, 56),
  band: sideArc(TX, TY, TR, T_Z + 2.4, P, 40),
  knurl: knurl(TX, TY, TR, T_TOP - 2.4, T_TOP, 64, P, 0.3),
  bezel: ring(TX, TY, TR - 1, T_TOP, P, 56),
  face: ring(TX, TY, TR - 2.4, T_TOP, P, 56),
  minor: TIMER_TICKS.minor,
  major: TIMER_TICKS.major,
  /* 06:30: the hour hand halfway between 6 and 7, the minute hand on 30 */
  hour: handOf(6.5 / 12, 7.2, 2, 0.9),
  minute: handOf(0.5, 10.6, 2.6, 0.6),
  hub: ring(TX, TY, 1.1, T_TOP + 0.2, P, 14),
  crown: solid({ x: TX - 2.2, y: TY - TR - 3.6, w: 4.4, d: 4, r: 1 }, T_Z + 1.6, 3.8, 3, 0.3),
  crownCap: solid({ x: TX - 3, y: TY - TR - 6, w: 6, d: 2.6, r: 1.2 }, T_Z + 1, 5, 3, 0.3),
};

/* ---------- conveyor: legs, rails, belt ---------- */

const FAR_RAIL: Plan = { x: RAIL_X0, y: -BELT_HALF - RAIL_D, w: RAIL_X1 - RAIL_X0, d: RAIL_D, r: 1 };
const NEAR_LEFT: Plan = { x: RAIL_X0, y: BELT_HALF, w: GAP_X0 - RAIL_X0, d: RAIL_D, r: 1 };
const NEAR_RIGHT: Plan = { x: GAP_X1, y: BELT_HALF, w: RAIL_X1 - GAP_X1, d: RAIL_D, r: 1 };
const RAIL_H = RAIL_TOP - RAIL_Z0;
const LEG = 7;

const legsAt = (y: number) =>
  LEGS_X.map((x) => ({
    foot: solid({ x: x - LEG / 2 - 2, y: y - LEG / 2 - 2, w: LEG + 4, d: LEG + 4, r: 1.5 }, 0, 1.4, 3),
    leg: solid({ x: x - LEG / 2, y: y - LEG / 2, w: LEG, d: LEG, r: 0.8 }, 1.4, RAIL_Z0 - 1.4, 3),
    screws: [at([x - LEG / 2 - 0.6, y, 1.4]), at([x + LEG / 2 + 0.6, y, 1.4])],
  }));

const railScrews = (plan: Plan, every: number) => {
  const out: Flat[] = [];
  for (let x = plan.x + 6; x <= plan.x + plan.w - 5; x += every) out.push(at([x, plan.y + plan.d / 2, RAIL_TOP]));
  return out;
};

export const CONVEYOR_ART = {
  farLegs: legsAt(-BELT_HALF - RAIL_D / 2),
  nearLegs: legsAt(BELT_HALF + RAIL_D / 2),
  farRail: solid(FAR_RAIL, RAIL_Z0, RAIL_H, 3, 0.6),
  farRailScrews: railScrews(FAR_RAIL, 24),
  belt: solid({ x: BELT_X0, y: -BELT_HALF, w: BELT_X1 - BELT_X0, d: BELT_HALF * 2, r: 0 }, BELT_UNDER, BELT_TOP - BELT_UNDER, 2),
  nearLeft: solid(NEAR_LEFT, RAIL_Z0, RAIL_H, 3, 0.6),
  nearRight: solid(NEAR_RIGHT, RAIL_Z0, RAIL_H, 3, 0.6),
  nearLeftSeam: sideSeam(NEAR_LEFT, RAIL_Z0 + 4, P, 3),
  nearRightSeam: sideSeam(NEAR_RIGHT, RAIL_Z0 + 4, P, 3),
  nearScrews: [...railScrews(NEAR_LEFT, 24), ...railScrews(NEAR_RIGHT, 24)],
  /* the belt wraps a roller at each end */
  rollers: [BELT_X0, BELT_X1].map((x) =>
    G.disc(0, BELT_HALF * 2, (BELT_TOP - BELT_UNDER) / 2, G.frameOf([x, -BELT_HALF, (BELT_TOP + BELT_UNDER) / 2], [0, 1, 0], [1, 0, 0], [0, 0, 1]), P),
  ) as SolidPaths[],
  /* roller axle bosses on the near rail's outer face */
  axles: [BELT_X0 + 6, BELT_X1 - 4].map((x) => ({
    ring: sideRing([x, BELT_HALF + RAIL_D, 12.4], 2.6, "y", P, 18),
    hub: at([x, BELT_HALF + RAIL_D, 12.4]),
  })),
};

/* the belt's moving slats, rebuilt as it runs */
export const SLAT_PITCH = 8;
export function slatsOf(offset: number) {
  const lines: string[] = [];
  const shift = ((offset % SLAT_PITCH) + SLAT_PITCH) % SLAT_PITCH;
  for (let x = BELT_X0 + shift; x < BELT_X1 - 0.5; x += SLAT_PITCH) {
    lines.push(onTop([[x, -BELT_HALF], [x, BELT_HALF]], BELT_TOP, P));
  }
  return join(lines);
}

/* ---------- the diverter: pin bracket, pin, cap and actuator ---------- */

const BRACKET: Plan = { x: GATE_X - 6, y: -BELT_HALF - RAIL_D, w: 12, d: RAIL_D, r: 1 };
const ARM: Plan = { x: GATE_X - 4, y: -BELT_HALF - 0.5, w: 8, d: GATE_Y - GATE_T / 2 - (-BELT_HALF - 0.5) + 4, r: 2 };
const ARM_Z = GATE_Z + GATE_H + 0.8;
const PIN = { x: GATE_X, y: GATE_Y - GATE_T / 2 };
const ACTUATOR: Plan = { x: GATE_X - 16, y: -BELT_HALF - RAIL_D - 9, w: 22, d: 9, r: 2 };

export const GATE_ART = {
  bracket: solid(BRACKET, RAIL_TOP, ARM_Z + 1.8 - RAIL_TOP, 3, 0.4),
  arm: solid(ARM, ARM_Z, 1.8, 3, 0.4),
  armScrews: [at([BRACKET.x + 2.5, BRACKET.y + RAIL_D / 2, ARM_Z + 1.8]), at([BRACKET.x + BRACKET.w - 2.5, BRACKET.y + RAIL_D / 2, ARM_Z + 1.8])],
  pin: post(PIN.x, PIN.y, 1.3, GATE_Z, ARM_Z - GATE_Z, 16),
  cap: post(PIN.x, PIN.y, 2.6, ARM_Z + 1.8, 2.2, 24),
  capKnurl: knurl(PIN.x, PIN.y, 2.6, ARM_Z + 1.8, ARM_Z + 4, 18, P),
  capRing: ring(PIN.x, PIN.y, 1.2, ARM_Z + 4, P, 14),
  /* solenoid that throws the paddle, bolted to the far rail */
  actuatorFoot: solid({ x: ACTUATOR.x - 2, y: ACTUATOR.y - 1, w: ACTUATOR.w + 4, d: ACTUATOR.d + 1, r: 1.5 }, RAIL_Z0, 1.2, 3),
  actuator: solid(ACTUATOR, RAIL_Z0 + 1.2, 9, 4, 0.6),
  actuatorSeam: sideSeam(ACTUATOR, RAIL_Z0 + 6.2, P, 4),
  actuatorVents: join([0, 1, 2].map((row) => planOutline({ x: ACTUATOR.x + 4, y: ACTUATOR.y + 2 + row * 2, w: 12, d: 0.9, r: 0.45 }, RAIL_Z0 + 10.2, P, 2))),
  actuatorScrews: [at([ACTUATOR.x + 2, ACTUATOR.y + 2, RAIL_Z0 + 10.2]), at([ACTUATOR.x + ACTUATOR.w - 2, ACTUATOR.y + 2, RAIL_Z0 + 10.2])],
};

/* the paddle at an angle (degrees), pivoting about the pin */
export function paddleOf(angle: number): SolidPaths {
  const a = (angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = Math.sin(a);
  const ny = -Math.cos(a);
  const x0 = GATE_X - ux * 1.2;
  const y0 = GATE_Y - uy * 1.2;
  const length = 34 + 1.2;
  const ringPoints: Plane[] = [
    [x0, y0],
    [x0 + ux * length, y0 + uy * length],
    [x0 + ux * length + nx * GATE_T, y0 + uy * length + ny * GATE_T],
    [x0 + nx * GATE_T, y0 + ny * GATE_T],
  ];
  return extrude(ringPoints, GATE_Z, GATE_H, P, { convex: true, bevel: 0.3 });
}

/* ---------- intake hopper ---------- */

const H = HOPPER_IN;
const W = HOPPER_WALL;
const HOP_Z = BELT_TOP + 0.6;
const BACK: Plan = { x: H.x - W, y: H.y - W, w: W, d: H.d + W * 2, r: 0.6 };
const FAR_SIDE: Plan = { x: H.x, y: H.y - W, w: H.w, d: W, r: 0.4 };
const NEAR_SIDE: Plan = { x: H.x, y: H.y + H.d, w: H.w, d: W, r: 0.4 };
const FRONT: Plan = { x: H.x + H.w, y: H.y - W, w: W, d: H.d + W * 2, r: 0.6 };
const brackets = (y0: number, y1: number) => solid({ x: H.x + 5, y: Math.min(y0, y1), w: 12, d: Math.abs(y1 - y0), r: 0.6 }, RAIL_TOP, 2, 2, 0.3);

export const HOPPER_ART = {
  back: solid(BACK, HOP_Z, HOPPER_TOP - HOP_Z, 3, 0.5),
  farSide: solid(FAR_SIDE, HOP_Z, HOPPER_TOP - HOP_Z, 2, 0.4),
  farBracket: brackets(-BELT_HALF - RAIL_D, H.y - W),
  nearSide: solid(NEAR_SIDE, HOP_Z, HOPPER_TOP - HOP_Z, 2, 0.4),
  nearBracket: brackets(H.y + H.d + W, BELT_HALF + RAIL_D),
  nearRivets: [0.25, 0.5, 0.75].map((share) => at([H.x + H.w * share, H.y + H.d + W, HOPPER_TOP - 3])),
  nearSeam: sideSeam(NEAR_SIDE, HOPPER_TOP - 6, P, 2),
  front: solid(FRONT, THROAT, HOPPER_TOP - THROAT, 3, 0.5),
  frontSeam: sideSeam(FRONT, HOPPER_TOP - 6, P, 3),
  frontRivets: [-0.3, 0, 0.3].map((share) => at([H.x + H.w + W, share * H.d, HOPPER_TOP - 3])),
  throatLip: line([H.x + H.w + W, H.y - W + 0.6, THROAT + 1.2], [H.x + H.w + W, H.y + H.d + W - 0.6, THROAT + 1.2]),
};

/* the stack of unread cards in the hopper */
const STACK: Plan = { x: H.x + 1, y: -CARD_D / 2, w: CARD_W, d: CARD_D, r: 0.5 };
export function stackOf(count: number, each: number) {
  const h = Math.max(0, count * each);
  if (h <= 0.01) return { paths: null, seams: "" };
  const paths = slabOf(STACK, BELT_TOP, h, P, 2, 0);
  const seams: string[] = [];
  for (let level = 6; level < count; level += 6) seams.push(sideSeam(STACK, BELT_TOP + level * each, P, 2));
  return { paths, seams: join(seams) };
}

/* ---------- transfer plate and the Today shelf ---------- */

const PLATE: Plan = { x: GAP_X0 + 1, y: BELT_HALF, w: GAP_X1 - GAP_X0 - 2, d: SHELF.y - BELT_HALF + 2, r: 1 };
const SHELF_LIP_BACK: Plan = { x: SHELF.x, y: SHELF.y, w: PLATE.x - SHELF.x, d: 2, r: 0.6 };
const SHELF_LIP_FRONT: Plan = { x: SHELF.x, y: SHELF.y + SHELF.d - 2.4, w: SHELF.w, d: 2.4, r: 0.8 };
const STOP: Plan = { x: SHELF.x, y: SHELF.y + 2, w: 3.6, d: SHELF.d - 4.4, r: 0.8 };

export const SHELF_ART = {
  plinth: solid(SHELF, 0, SHELF_TOP, 6, 1.2),
  plinthSeam: sideSeam(SHELF, 4, P, 6),
  plate: solid(PLATE, PLATE_TOP - 1.4, 1.4, 2, 0.4),
  plateScrews: [at([PLATE.x + 3, PLATE.y + PLATE.d - 3, PLATE_TOP]), at([PLATE.x + PLATE.w - 3, PLATE.y + PLATE.d - 3, PLATE_TOP])],
  /* the plate stands on two short posts down to the shelf top */
  platePosts: [PLATE.x + 6, PLATE.x + PLATE.w - 6].map((x) => post(x, SHELF.y + 1.2, 1.2, SHELF_TOP, PLATE_TOP - 1.4 - SHELF_TOP, 16)),
  backLip: solid(SHELF_LIP_BACK, SHELF_TOP, 1.6, 2),
  stop: solid(STOP, SHELF_TOP, 5, 2, 0.4),
  stopScrews: [at([STOP.x + 1.8, STOP.y + 3, SHELF_TOP + 5]), at([STOP.x + 1.8, STOP.y + STOP.d - 3, SHELF_TOP + 5])],
  frontLip: solid(SHELF_LIP_FRONT, SHELF_TOP, 2.4, 2, 0.3),
  seats: (() => {
    const t = topTicks(SEAT_X0 - SEAT_PITCH / 2, SEAT_X0 - SEAT_PITCH / 2 + SEATS * SEAT_PITCH, SEAT_PITCH / 4, 4, SHELF_LIP_FRONT.y + 0.1, SHELF_TOP + 2.4, [0.9, 2], P);
    return t;
  })(),
  /* seat outlines engraved into the shelf top */
  seatLines: join(
    Array.from({ length: SEATS }, (_, seat) =>
      planOutline({ x: SEAT_X0 + seat * SEAT_PITCH - CARD_W / 2 - 1, y: SHELF.y + 4, w: CARD_W + 2, d: CARD_D + 2, r: 1.2 }, SHELF_TOP, P, 3),
    ),
  ),
};

/* ---------- the Later bin ---------- */

const B = BIN;
const BIN_BACK: Plan = { x: B.x, y: B.y, w: B.w, d: BIN_WALL, r: 0.8 };
const BIN_FAR: Plan = { x: B.x, y: B.y + BIN_WALL, w: BIN_WALL, d: B.d - BIN_WALL * 2, r: 0.4 };
const BIN_FRONT: Plan = { x: B.x, y: B.y + B.d - BIN_WALL, w: B.w, d: BIN_WALL, r: 0.8 };
const BIN_RIGHT: Plan = { x: B.x + B.w - BIN_WALL, y: B.y + BIN_WALL, w: BIN_WALL, d: B.d - BIN_WALL * 2, r: 0.4 };

export const BIN_ART = {
  halo: slabOf(insetPlan(B, 2), 0, 0.2, P).fill,
  floor: solid(insetPlan(B, BIN_WALL - 0.2), 0, BIN_FLOOR, 2),
  back: solid(BIN_BACK, 0, BIN_H, 3, 0.4),
  far: solid(BIN_FAR, 0, BIN_LIP, 2, 0.4),
  farRivets: [0.2, 0.5, 0.8].map((share) => at([B.x + BIN_WALL / 2, B.y + BIN_WALL + (B.d - BIN_WALL * 2) * share, BIN_LIP])),
  front: solid(BIN_FRONT, 0, BIN_H, 3, 0.5),
  frontSeam: sideSeam(BIN_FRONT, 3.2, P, 3),
  right: solid(BIN_RIGHT, 0, BIN_H, 2, 0.5),
  rightSeam: sideSeam(BIN_RIGHT, 3.2, P, 2),
  rivets: [B.x + 6, B.x + B.w / 2, B.x + B.w - 6].map((x) => at([x, B.y + B.d - BIN_WALL / 2, BIN_H])),
  backRivets: [B.x + 6, B.x + B.w / 2, B.x + B.w - 6].map((x) => at([x, B.y + BIN_WALL / 2, BIN_H])),
};

export function pileOf(level: number, each: number, plan: Plan) {
  const h = Math.max(0, level * each);
  if (h < 0.05) return { paths: null, seams: "" };
  const seams: string[] = [];
  for (let count = 5; count < level; count += 5) seams.push(sideSeam(plan, BIN_FLOOR + count * each, P, 2));
  return { paths: slabOf(plan, BIN_FLOOR, h, P, 2, 0), seams: join(seams) };
}

/* ---------- cards ---------- */

const CARD: Plan = { x: -CARD_W / 2, y: -CARD_D / 2, w: CARD_W, d: CARD_D, r: 0.8 };
const T = CARD_T;
const top = (points: Plane[], closed = false) => onTop(points, T, P, closed);
const hx = CARD_W / 2;
const hy = CARD_D / 2;

export const CARD_ART = {
  body: slabOf(CARD, 0, T, P, 2, 0),
  /* an envelope: flap V from the far corners, a stamp */
  mail: {
    lines: top([[-hx + 0.5, -hy + 0.4], [0, 1.5], [hx - 0.5, -hy + 0.4]]),
    stamp: planOutline({ x: hx - 6.4, y: hy - 7.6, w: 4.4, d: 5, r: 0.4 }, T, P, 2),
    text: top([[-hx + 3, hy - 5], [-hx + 11, hy - 5]]) + top([[-hx + 3, hy - 3], [-hx + 8.5, hy - 3]]),
  },
  /* an index card: header rule edge to edge, a checkbox, written lines */
  task: {
    lines: top([[-hx, -hy + 6], [hx, -hy + 6]]),
    stamp: planOutline({ x: -hx + 2.6, y: -hy + 1.6, w: 2.8, d: 2.8, r: 0.3 }, T, P, 2),
    text: join([0, 1, 2, 3].map((row) => top([[-hx + 3, -hy + 10 + row * 3.6], [row === 3 ? 0 : hx - 3, -hy + 10 + row * 3.6]]))),
  },
  /* an event card: a header band and a grid of day cells */
  event: {
    lines: top([[-hx, -hy + 7], [hx, -hy + 7]]) + top([[-hx, hy - 6], [hx, hy - 6]]),
    stamp: join(
      [0, 1, 2].flatMap((col) => [0, 1].map((row) => planOutline({ x: -hx + 3 + col * 5.2, y: -hy + 9.6 + row * 4.8, w: 3.6, d: 3.4, r: 0.3 }, T, P, 2))),
    ),
    text: top([[-hx + 3, -hy + 3.4], [-hx + 10, -hy + 3.4]]),
  },
};

export const CARD_KINDS = ["mail", "task", "event"] as const;
