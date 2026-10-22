import { describe, expect, it } from "vitest";
import { sceneAt } from "./frame";
import { ACTION, CLOSE, END, NEEDS_CONFIRM, OFF, ON, OPEN, appliedAt, batAt, classesOf, coverAt, readoutOf } from "./model";
import { BAT_OFF, BAT_ON, COVER_OPEN } from "./view";

describe("Fig 3 model", () => {
  it("classifies actions the way the product does", () => {
    expect(classesOf(ACTION)).toEqual(["BULK"]);
    expect(NEEDS_CONFIRM).toBe(true);
    expect(classesOf({ modifies: 1 })).toEqual([]);
    expect(classesOf({ modifies: 1, deletes: true })).toEqual(["DESTRUCTIVE"]);
    expect(classesOf({ modifies: 1, external: true })).toEqual(["EXTERNAL"]);
  });

  it("starts and ends closed and unapplied, with the documented readout", () => {
    for (const t of [0, END]) {
      expect(coverAt(t)).toBeCloseTo(0);
      expect(batAt(t)).toBeCloseTo(BAT_OFF);
      expect(appliedAt(t)).toBe(false);
    }
    expect(readoutOf(END)).toBe("4 changes · confirm to apply");
  });

  it("never flips the switch while the cover is down", () => {
    for (let t = 0; t <= END; t += 0.01) {
      if (batAt(t) !== BAT_OFF) expect(coverAt(t)).toBeCloseTo(COVER_OPEN, 3);
    }
    expect(ON[0]).toBeGreaterThan(OPEN[1]);
    expect(CLOSE[0]).toBeGreaterThan(OFF[1]);
  });

  it("lights the lamp only while applied, and offers Undo", () => {
    expect(batAt(ON[1])).toBeCloseTo(BAT_ON);
    expect(sceneAt(ON[1]).lit).toBe(true);
    expect(readoutOf(ON[1])).toBe("4 changes applied · Undo");
    expect(sceneAt(OFF[1]).lit).toBe(false);
  });

  it("draws the bat over the cover only once the cover has swung behind its hinge", () => {
    expect(sceneAt(0).coverSlot).toBe("front");
    expect(sceneAt(ON[1]).coverSlot).toBe("back");
    expect(sceneAt(ON[1]).batSlot).toBe("plain");
  });
});
