import { axisVector, cameraOf, cylinder, iso, pathOf } from "../kit/iso-kit";
import { AXLE_Z, BAND_R, BRIDGE_H, CROSS_H, CROSS_Z, FRAME_TOP, KNOB_Z, P, STEM_R, THUMB_R, THUMB_X0, THUMB_X1 } from "./view";

/* Fig 2 parts whose shape changes with time. Kept apart from geometry.ts so
   the live chunk does not carry the static art or the lathe module. */

const join = (paths: string[]) => paths.filter(Boolean).join("");

/* The stem between the carriage and the bridge, and above the bridge. */
export const lowerStemOf = (drop: number) => {
  const from = CROSS_Z + CROSS_H - drop;
  return cylinder(0, 0, STEM_R, from, FRAME_TOP - from, P, 20);
};
export const upperStemOf = (drop: number) => {
  const from = FRAME_TOP + BRIDGE_H;
  return cylinder(0, 0, STEM_R, from, KNOB_Z - 1.6 - drop - from, P, 20);
};

/* Visible ribs of the thumb wheel's grip, turned by `turn` radians. */
const CAMERA = cameraOf(P);
const facing = (a: number) => CAMERA.sinA * CAMERA.cosE * Math.cos(a) + CAMERA.sinE * Math.sin(a);

export function thumbRibsOf(turn: number, count = 30) {
  const paths: string[] = [];
  for (let index = 0; index < count; index++) {
    const a = turn + (index / count) * Math.PI * 2;
    if (facing(a) < 0.12) continue;
    const y = THUMB_R * Math.cos(a);
    const z = AXLE_Z + THUMB_R * Math.sin(a);
    paths.push(pathOf([iso([THUMB_X0, y, z], P), iso([THUMB_X1, y, z], P)]));
  }
  return join(paths);
}

/* Characters on a band: the matrix that lays text on the band's surface at
   angle `a` (0 faces the viewer's side, +y; positive turns toward the top). */
export function bandTextAt(x: number, a: number) {
  const r = BAND_R + 0.05;
  const origin = iso([x, r * Math.cos(a), AXLE_Z + r * Math.sin(a)], P);
  const u = axisVector(P, [1, 0, 0]);
  const v = axisVector(P, [0, Math.sin(a), -Math.cos(a)]);
  const k = (n: number) => Math.round(n * 1000) / 1000;
  return { transform: `matrix(${k(u[0])} ${k(u[1])} ${k(v[0])} ${k(v[1])} ${k(origin[0])} ${k(origin[1])})`, facing: facing(a) };
}


