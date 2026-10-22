import { describe, expect, it } from "vitest";
import { END, ITEMS, MOST_TODAY, NEED_TOTAL, TOTAL, countsAt, gateAt, poseOf, readoutOf, seatOf, seatX } from "./model";
import { CARD_D, CARD_W, GATE_LEN, GATE_X, GATE_Y, SHELF, SHELF_Y } from "./view";

const STEP = 1 / 120;

function paddleHits(angle: number, x: number, y: number) {
  // Does the paddle segment pass through the card rectangle centred at (x, y)?
  const a = (angle * Math.PI) / 180;
  for (let s = 0; s <= GATE_LEN; s += 0.5) {
    const px = GATE_X + Math.cos(a) * s;
    const py = GATE_Y + Math.sin(a) * s;
    if (Math.abs(px - x) < CARD_W / 2 && Math.abs(py - y) < CARD_D / 2) return true;
  }
  return false;
}

describe("sorter model", () => {
  it("encodes the briefing numbers the readout shows", () => {
    expect(TOTAL).toBe(43);
    expect(NEED_TOTAL).toBe(6);
    expect(NEED_TOTAL).toBeLessThanOrEqual(MOST_TODAY);
    expect(readoutOf(END)).toBe("06:30 · 43 in → 6 need you");
    expect(readoutOf(0)).toBe("06:30 · 0 in → 0 need you");
    const done = countsAt(END);
    expect(done.stack).toBe(0);
    expect(Math.round(done.pile)).toBe(TOTAL - NEED_TOTAL);
  });

  it("never sweeps the paddle through a card it lets pass", () => {
    for (let t = 0; t <= END; t += STEP) {
      const angle = gateAt(t);
      if (angle <= 0) continue;
      ITEMS.forEach((item, index) => {
        if (item.need) return;
        const pose = poseOf(index, t);
        if (!pose || pose.layer !== "belt") return;
        expect(paddleHits(angle, pose.x, pose.y), `card ${index} at t=${t.toFixed(3)}`).toBe(false);
      });
    }
  });

  it("keeps cards from running into each other", () => {
    for (let t = 0; t <= END; t += STEP) {
      const live = ITEMS.map((_, index) => poseOf(index, t)).filter((pose) => pose && pose.layer !== "bin");
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i]!;
          const b = live[j]!;
          const apart = Math.abs(a.x - b.x) >= CARD_W - 0.01 || Math.abs(a.y - b.y) >= CARD_D - 0.01;
          expect(apart, `cards ${a.index} and ${b.index} at t=${t.toFixed(3)}`).toBe(true);
        }
      }
    }
  });

  it("parks each card that needs you on its own seat on the shelf", () => {
    const seats = new Set<number>();
    ITEMS.forEach((item, index) => {
      if (!item.need) return;
      const pose = poseOf(index, END)!;
      expect(pose.layer).toBe("out");
      expect(pose.y).toBeCloseTo(SHELF_Y, 5);
      expect(pose.x).toBeCloseTo(seatX(seatOf[index]!), 5);
      expect(pose.x - CARD_W / 2).toBeGreaterThan(SHELF.x);
      seats.add(seatOf[index]!);
    });
    expect(seats.size).toBe(NEED_TOTAL);
  });

  it("lets every Later card vanish into the pile by the end", () => {
    ITEMS.forEach((item, index) => {
      if (item.need) return;
      expect(poseOf(index, END)).toBeNull();
    });
  });
});
