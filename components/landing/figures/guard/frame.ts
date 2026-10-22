import type { SolidPaths } from "../kit/iso-kit";
import { appliedAt, batAt, coverAt, readoutOf } from "./model";
import { batOf, coverOf } from "./motion";
import { HEIGHT, WIDTH } from "./view";

/* Which copy of the cover and the bat is shown depends on the cover's angle.
   While the cover is in front of its hinge, the bat is drawn after it but
   clipped to where the cover does not hide it: outside the cover's outline,
   or inside its open bottom when that faces the viewer. Once the cover has
   swung behind its hinge, it is drawn first and the bat plainly after. */
export type BatSlot = "clipped" | "plain";

export interface Scene {
  cover: SolidPaths;
  cavity: string;
  coverSlot: "front" | "back";
  clip: string;
  shaft: SolidPaths;
  tip: SolidPaths;
  batSlot: BatSlot;
  lit: boolean;
  readout: string;
}

const FRAME = `M0 0H${WIDTH}V${HEIGHT}H0Z`;

export function sceneAt(t: number): Scene {
  const cover = coverOf(coverAt(t));
  const bat = batOf(batAt(t));
  return {
    cover: cover.paths,
    cavity: cover.cavity,
    coverSlot: cover.front ? "front" : "back",
    clip: cover.front ? `${FRAME}${cover.paths.outline}${cover.cavity}` : FRAME,
    shaft: bat.shaft,
    tip: bat.tip,
    batSlot: cover.front ? "clipped" : "plain",
    lit: appliedAt(t),
    readout: readoutOf(t),
  };
}
