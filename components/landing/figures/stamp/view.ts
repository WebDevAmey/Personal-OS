import { boxCorners, fitProjection, type Plan, type Point3 } from "../kit/iso-kit";

/*
 * World layout for Fig 2, the rotary date stamp. x runs along the stamp's
 * axle, y toward the viewer, z up. The stamp is a self-inking dater: an outer
 * frame stands on the desk pad, and an inner carriage (axle, three bands,
 * crossbar, stem and knob) slides down inside it to print.
 */

export const WIDTH = 560;
export const HEIGHT = 400;
export const AZIMUTH = 55;

export const PAD: Plan = { x: -74, y: -46, w: 150, d: 100, r: 6 };
export const PAD_H = 4;

/* the index card slides along a track between the frame's feet */
export const CARD: Plan = { x: -20, y: -12, w: 40, d: 24, r: 1.2 };
export const CARD_T = 0.8;
export const CARD_TOP = PAD_H + CARD_T;
export const CARD_OUT = 34;
export const TRACK_X = 20.4;
export const TRACK_Y0 = -16;
export const TRACK_Y1 = 50;

/* bands on the axle: day, month, year */
export const BAND_R = 13;
export const GAP = 8;
export const AXLE_Z = CARD_TOP + BAND_R + GAP;
export const PRESS = GAP;
export const BANDS = [
  { key: "day", x0: -17, x1: -8.2 },
  { key: "month", x0: -6.8, x1: 5.4 },
  { key: "year", x0: 6.8, x1: 17 },
] as const;
export const SPACER_R = 11;
export const AXLE_R = 2.4;

/* outer frame */
export const PLATE_IN = 23;
export const PLATE_T = 3;
export const PLATE_Y = 15;
export const FRAME_TOP = 50;
export const BRIDGE: Plan = { x: -PLATE_IN - PLATE_T, y: -9, w: (PLATE_IN + PLATE_T) * 2, d: 18, r: 1.5 };
export const BRIDGE_H = 4;

/* inner carriage */
export const ARM_T = 1;
export const ARM_Y = 4.5;
export const CROSS: Plan = { x: -PLATE_IN + 0.2, y: -5, w: (PLATE_IN - 0.2) * 2, d: 10, r: 1 };
export const CROSS_Z = AXLE_Z + BAND_R + 1.2;
export const CROSS_H = 3;
export const STEM_R = 2.2;
export const KNOB_R = 8.5;
export const KNOB_Z = 66;
export const KNOB_H = 5;

/* thumb wheel outside the near plate, geared to the day band */
export const THUMB_X0 = PLATE_IN + PLATE_T + 1;
export const THUMB_X1 = THUMB_X0 + 4;
export const THUMB_R = 9;

/* the slip with the typed word, and the desk calendar showing today */
export const SLIP: Plan = { x: -66, y: 22, w: 30, d: 13, r: 0.8 };
export const BLOCK: Plan = { x: 36, y: -42, w: 28, d: 26, r: 1.5 };
export const BLOCK_H = 9;

export const P = fitProjection(
  [...boxCorners(PAD, 0, PAD_H), [0, 0, KNOB_Z + KNOB_H + 1] as Point3, [THUMB_X1, 0, AXLE_Z + THUMB_R] as Point3],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: AZIMUTH },
);
