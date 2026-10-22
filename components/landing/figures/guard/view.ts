import { boxCorners, fitProjection, type Plan, type Point3 } from "../kit/iso-kit";

/*
 * World layout for Fig 3, the guarded switch. x runs left to right along the
 * panel, y toward the viewer, z up. The cover is hinged along x at the back
 * of the switch bezel and flips up and back; the bat lever tilts in y.
 */

export const WIDTH = 560;
export const HEIGHT = 380;
export const AZIMUTH = 50;

export const PANEL: Plan = { x: -40, y: -28, w: 80, d: 56, r: 4 };
export const PANEL_H = 9;
export const FOOT_H = 3;
export const TOP = FOOT_H + PANEL_H;

/* switch bezel and toggle */
export const BEZEL: Plan = { x: -30, y: -21, w: 22, d: 23, r: 2 };
export const BEZEL_H = 2.4;
export const BEZEL_TOP = TOP + BEZEL_H;
export const SWITCH_X = BEZEL.x + BEZEL.w / 2;
export const NUT_R = 3.4;
export const NUT_H = 1.8;
export const PIVOT: Point3 = [SWITCH_X, BEZEL.y + 12, BEZEL_TOP + NUT_H];
export const BAT_LEN = 8.6;
export const BAT_R0 = 1.25;
export const BAT_R1 = 0.85;
export const TIP_R = 1.6;
export const BAT_OFF = -24;
export const BAT_ON = 24;

/* the cover: an open-bottomed hood on a hinge barrel */
export const HINGE_R = 1.5;
export const HINGE: Point3 = [SWITCH_X, BEZEL.y + 2, BEZEL_TOP + HINGE_R];
export const HOOD_W = 8.2;
export const HOOD_D = 19;
export const HOOD_Z0 = -HINGE_R;
export const HOOD_Z1 = 12.6;
/* the hood's front slopes back from this height to the top */
export const HOOD_NOSE = 6.5;
export const HOOD_TOP_D = 12;
export const HOOD_WALL = 1.1;
export const COVER_OPEN = 108;

/* lamp, undo button and labels */
export const LAMP: [number, number] = [22, -14];
export const LAMP_R = 4.6;
export const LENS_R = 3.2;
export const UNDO: [number, number] = [22, 7];
export const UNDO_R = 3.6;

export const P = fitProjection(
  [...boxCorners(PANEL, 0, TOP), [SWITCH_X - HOOD_W, -37, BEZEL_TOP + 17] as Point3, [SWITCH_X + HOOD_W, -37, BEZEL_TOP + 17] as Point3],
  WIDTH,
  HEIGHT,
  { pad: 24, azimuth: AZIMUTH },
);
