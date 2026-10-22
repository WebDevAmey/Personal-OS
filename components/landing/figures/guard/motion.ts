import { depthOf, iso, pathOf, type Point3, type SolidPaths } from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import { BAT_LEN, BAT_R0, BAT_R1, HINGE, HOOD_D, HOOD_NOSE, HOOD_TOP_D, HOOD_W, HOOD_WALL, HOOD_Z0, HOOD_Z1, P, PIVOT, TIP_R } from "./view";

/* Fig 3 parts whose shape changes: the cover turning on its hinge and the bat
   tilting on its pivot. Angles are in degrees. */

const RADIANS = Math.PI / 180;
const VIEW = G.viewOf(P) as Point3;

/* The cover turns about the hinge (along x). In its own frame y' runs from
   the hinge to the front and z' out through the top; at `open` = 0 those are
   world y and z. */
function coverAxes(open: number) {
  const c = Math.cos(open * RADIANS);
  const s = Math.sin(open * RADIANS);
  return { y: [0, c, s] as Point3, z: [0, -s, c] as Point3 };
}

/* The hood's side profile in (y', z'): flat top, sloped nose, open bottom. */
const PROFILE: [number, number][] = [
  [0, HOOD_Z0],
  [HOOD_D, HOOD_Z0],
  [HOOD_D, HOOD_NOSE],
  [HOOD_TOP_D, HOOD_Z1],
  [0, HOOD_Z1],
];

export interface Cover {
  paths: SolidPaths;
  cavity: string;
  /* the cover is nearer the viewer than its hinge (drawn after the bat) */
  front: boolean;
}

export function coverOf(open: number): Cover {
  const axes = coverAxes(open);
  const F = G.frameOf([HINGE[0] - HOOD_W, HINGE[1], HINGE[2]], [1, 0, 0], axes.y, axes.z);
  const paths = G.prismOf(F, PROFILE, 0, HOOD_W * 2, P) as SolidPaths;
  const at = (x: number, y: number, z: number): Point3 => [
    HINGE[0] + x,
    HINGE[1] + axes.y[1] * y + axes.z[1] * z,
    HINGE[2] + axes.y[2] * y + axes.z[2] * z,
  ];
  const opening = -(axes.z[1] * VIEW[1] + axes.z[2] * VIEW[2]) > 0.02;
  const w = HOOD_W - HOOD_WALL;
  const cavity = opening
    ? pathOf(
        ([[-w, HOOD_WALL], [w, HOOD_WALL], [w, HOOD_D - HOOD_WALL], [-w, HOOD_D - HOOD_WALL]] as [number, number][]).map(([x, y]) => iso(at(x, y, HOOD_Z0), P)),
        true,
      )
    : "";
  const centre = at(0, HOOD_D / 2, (HOOD_Z0 + HOOD_Z1) / 2);
  return { paths, cavity, front: depthOf(centre, P) > depthOf(HINGE, P) };
}

export interface Bat {
  shaft: SolidPaths;
  tip: SolidPaths;
}

export function batOf(tilt: number): Bat {
  const dir: Point3 = [0, Math.sin(tilt * RADIANS), Math.cos(tilt * RADIANS)];
  const side: Point3 = [0, Math.cos(tilt * RADIANS), -Math.sin(tilt * RADIANS)];
  const F = G.frameOf(PIVOT, dir, [1, 0, 0], side);
  const end = G.pointOf(F, BAT_LEN, 0, 0) as Point3;
  return {
    shaft: G.solidOf([[1.2, BAT_R0], [BAT_LEN, BAT_R1]], F, P) as SolidPaths,
    tip: G.sphereOf(end, TIP_R, P) as SolidPaths,
  };
}
