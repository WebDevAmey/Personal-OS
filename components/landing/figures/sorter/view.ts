import { boxCorners, fitProjection, iso, type Plan, type Point3 } from "../kit/iso-kit";

/*
 * World layout for Fig 1, the sorting desk. Units are about 1 px of the real
 * object; x runs along the belt, y toward the viewer, z up.
 */

export const WIDTH = 600;
export const HEIGHT = 350;
export const AZIMUTH = 55;

export const BASE: Plan = { x: -156, y: -54, w: 306, d: 136, r: 9 };
export const BASE_H = 9;
export const FOOT_H = 5;

/* belt and frame */
export const BELT_X0 = -126;
export const BELT_X1 = 62;
export const BELT_HALF = 18;
export const BELT_TOP = 14;
export const BELT_UNDER = 11;
export const RAIL_D = 6;
export const RAIL_Z0 = 6;
export const RAIL_TOP = 19;
export const RAIL_X0 = -130;
export const RAIL_X1 = 64;
/* the outlet in the near rail, where diverted cards leave the belt */
export const GAP_X0 = -30;
export const GAP_X1 = 42;
export const LEGS_X = [-114, 50];

/* cards */
export const CARD_W = 20;
export const CARD_D = 26;
export const CARD_T = 0.8;

/* intake hopper over the start of the belt */
export const HOPPER_X = -110;
export const HOPPER_IN: Plan = { x: -121, y: -14, w: 22, d: 28, r: 0.6 };
export const HOPPER_WALL = 3;
export const HOPPER_TOP = 42;
export const THROAT = 16.6;
export const STACK_EACH = 0.56;

/* the diverter gate: a paddle on a vertical pin at the far rail */
export const GATE_X = -14;
export const GATE_T = 1.8;
export const GATE_Y = -BELT_HALF + GATE_T + 0.4;
export const GATE_LEN = 34;
export const GATE_Z = BELT_TOP + 0.4;
export const GATE_H = 5.4;
export const GATE_OPEN = 45;

/* transfer plate and the Today shelf */
export const PLATE_TOP = BELT_TOP;
export const SHELF: Plan = { x: -146, y: 38, w: 200, d: 36, r: 3 };
export const SHELF_TOP = 10;
export const SHELF_Y = 55;
export const SEAT_PITCH = 24;
export const SEAT_X0 = -128;
export const SEATS = 7;

/* the Later bin at the end of the belt */
export const BIN: Plan = { x: 66, y: -40, w: 70, d: 66, r: 2 };
export const BIN_WALL = 4;
export const BIN_H = 13;
export const BIN_LIP = 7;
export const BIN_FLOOR = 1.2;
export const PILE: Plan = { x: 74, y: -31, w: 50, d: 48, r: 2 };
export const PILE_EACH = 0.2;

/* the timer that starts the sort at the briefing hour */
export const TIMER_AT: [number, number] = [114, 52];

export const P = fitProjection(
  [
    ...boxCorners(BASE, -BASE_H - FOOT_H, 0),
    ...boxCorners({ x: HOPPER_IN.x - HOPPER_WALL, y: HOPPER_IN.y - HOPPER_WALL - 7, w: HOPPER_IN.w + HOPPER_WALL * 2, d: HOPPER_IN.d + HOPPER_WALL * 2 + 14, r: 0 }, 0, HOPPER_TOP),
  ],
  WIDTH,
  HEIGHT,
  { pad: 20, azimuth: AZIMUTH },
);

export const at = (point: Point3) => iso(point, P);
