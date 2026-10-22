import { describe, expect, it } from "vitest";
import { POOL, sceneAt } from "./frame";
import { DECIDED_AT, END, ITEMS, poseOf, type Layer } from "./model";

describe("Fig 1 frame", () => {
  it("never needs more card slots than the pool holds", () => {
    const most: Record<Layer, number> = { belt: 0, out: 0, bin: 0 };
    for (let t = 0; t <= END + 0.5; t += 1 / 120) {
      const count: Record<Layer, number> = { belt: 0, out: 0, bin: 0 };
      ITEMS.forEach((_, index) => {
        const pose = poseOf(index, t);
        if (pose) count[pose.layer]++;
      });
      (Object.keys(count) as Layer[]).forEach((layer) => (most[layer] = Math.max(most[layer], count[layer])));
    }
    (Object.keys(most) as Layer[]).forEach((layer) => expect(most[layer]).toBeLessThanOrEqual(POOL[layer]));
  });

  it("keeps the shelf at seven seats or fewer at the end", () => {
    const shelf = sceneAt(END).cards.out.filter(Boolean);
    expect(shelf.length).toBe(6);
    expect(shelf.length).toBeLessThanOrEqual(7);
  });

  it("has one keyboard stop per item, in order", () => {
    expect(DECIDED_AT).toHaveLength(ITEMS.length);
    DECIDED_AT.forEach((at, index) => index && expect(at).toBeGreaterThan(DECIDED_AT[index - 1]!));
    expect(DECIDED_AT.at(-1)!).toBeLessThan(END);
  });
});
