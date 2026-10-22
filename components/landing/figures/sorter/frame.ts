import { depthOf, translateAlong, type SolidPaths } from "../kit/iso-kit";
import { paddleOf, pileOf, slatsOf, stackOf } from "./geometry";
import { END, ITEMS, SPEED, START, countsAt, gateAt, poseOf, readoutOf, type Layer, type Pose } from "./model";
import { P, PILE, PILE_EACH, STACK_EACH } from "./view";

/* Pool sizes: the most cards ever in each layer at once (checked in
   frame.test.ts). Each slot is one <use> of a card template. */
export const POOL: Record<Layer, number> = { belt: 10, out: 7, bin: 4 };

export interface CardSlot {
  href: string;
  transform: string;
  opacity: string;
}

export interface Scene {
  paddle: SolidPaths;
  stack: ReturnType<typeof stackOf>;
  pile: ReturnType<typeof pileOf>;
  slats: string;
  cards: Record<Layer, (CardSlot | null)[]>;
  readout: string;
}

export const templateId = (pose: Pick<Pose, "kind" | "need" | "lit">) => `sorter-${pose.kind}${pose.lit ? "-lit" : pose.need ? "-need" : ""}`;

export function belt(t: number) {
  return SPEED * Math.min(Math.max(t - START, 0), END);
}

export function sceneAt(t: number): Scene {
  const counts = countsAt(t);
  const layers: Record<Layer, Pose[]> = { belt: [], out: [], bin: [] };
  for (let index = 0; index < ITEMS.length; index++) {
    const pose = poseOf(index, t);
    if (pose) layers[pose.layer].push(pose);
  }
  const cards = {} as Record<Layer, (CardSlot | null)[]>;
  (Object.keys(layers) as Layer[]).forEach((layer) => {
    const list = layers[layer].sort((a, b) => depthOf([a.x, a.y, a.z], P) - depthOf([b.x, b.y, b.z], P));
    cards[layer] = Array.from({ length: POOL[layer] }, (_, slot) => {
      const pose = list[slot];
      if (!pose) return null;
      return {
        href: `#${templateId(pose)}`,
        transform: translateAlong(P, [pose.x, pose.y, pose.z]),
        opacity: pose.alpha >= 1 ? "" : `${Math.round(pose.alpha * 100) / 100}`,
      };
    });
  });
  return {
    paddle: paddleOf(gateAt(t)),
    stack: stackOf(counts.stack, STACK_EACH),
    pile: pileOf(counts.pile, PILE_EACH, PILE),
    slats: slatsOf(belt(t)),
    cards,
    readout: readoutOf(t),
  };
}
