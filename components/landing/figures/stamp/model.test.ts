import { describe, expect, it } from "vitest";
import { sceneAt } from "./frame";
import { END, STOPS, TARGET, TODAY, bandsAt, cardAt, dropAt, inkedAt, printed, readoutOf, resolve, spoken, stageOf } from "./model";
import { CARD_OUT, PRESS } from "./view";

describe("Fig 2 model", () => {
  it("resolves tomorrow from Wed 21 Oct 2026 to Thu 22 Oct", () => {
    expect(spoken(TODAY)).toBe("Wed 21 Oct");
    expect(spoken(TARGET)).toBe("Thu 22 Oct");
    expect(printed(TARGET)).toBe("22 OCT 2026");
    expect(readoutOf(END)).toBe('"tomorrow" → Thu 22 Oct');
  });

  it("resolves deterministically, across month and year ends", () => {
    expect(resolve("tomorrow", TODAY)).toBe(resolve("Tomorrow ", TODAY));
    expect(printed(resolve("tomorrow", Date.UTC(2026, 9, 31))!)).toBe("01 NOV 2026");
    expect(printed(resolve("tomorrow", Date.UTC(2026, 11, 31))!)).toBe("01 JAN 2027");
    expect(resolve("someday", TODAY)).toBeNull();
  });

  it("rolls only the day band, and only by one", () => {
    expect(bandsAt(0)).toEqual({ day: 21, month: 9, year: 2026 });
    expect(bandsAt(END)).toEqual({ day: 22, month: 9, year: 2026 });
  });

  it("inks the card only once the bands reach it, and slides it out after lifting", () => {
    const contact = STOPS[1]!;
    expect(dropAt(contact)).toBeCloseTo(PRESS);
    expect(inkedAt(contact - 0.01)).toBe(false);
    expect(inkedAt(contact)).toBe(true);
    expect(cardAt(STOPS[2]!)).toBe(0);
    expect(dropAt(END)).toBe(0);
    expect(cardAt(END)).toBe(CARD_OUT);
    expect(stageOf(0)).toBe(0);
    expect(stageOf(END)).toBe(STOPS.length);
  });

  it("shows the target date on the reading line at the end", () => {
    const scene = sceneAt(END);
    const reading = scene.chars.map((slots) => [...slots].sort((a, b) => b.opacity - a.opacity)[0]!.text);
    expect(reading).toEqual(["22", "OCT", "2026"]);
  });
});
