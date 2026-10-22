import { translateAlong, type SolidPaths } from "../kit/iso-kit";
import { bandTextAt, lowerStemOf, thumbRibsOf, upperStemOf } from "./motion";
import { bandsAt, cardAt, dropAt, inkedAt, monthName, readoutOf } from "./model";
import { BANDS, P } from "./view";

/* Each band carries its characters all the way round; the figure draws the
   few around the reading line, which sits a little above the front. */
export const READING = 0.42;
export const SLOTS = 4;

const BAND_SPEC = {
  day: { count: 31, size: 2.9, dim: 0.82, label: (k: number) => String(wrap(k - 1, 31) + 1).padStart(2, "0") },
  month: { count: 12, size: 2.9, dim: 0.62, label: (k: number) => monthName(k) },
  year: { count: 10, size: 2.6, dim: 0.62, label: (k: number) => String(2020 + wrap(k - 2020, 10)) },
} as const;

const wrap = (value: number, count: number) => ((value % count) + count) % count;
const fade = (value: number, lo: number, hi: number) => {
  const x = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
};

export interface CharSlot {
  text: string;
  transform: string;
  opacity: number;
}

export interface Scene {
  carriage: string;
  card: string;
  inked: boolean;
  lowerStem: SolidPaths;
  upperStem: SolidPaths;
  thumbRibs: string;
  chars: CharSlot[][];
  readout: string;
}

export const sizeOf = (key: keyof typeof BAND_SPEC) => BAND_SPEC[key].size;

export function sceneAt(t: number): Scene {
  const drop = dropAt(t);
  const values = bandsAt(t);
  const chars = BANDS.map((band) => {
    const spec = BAND_SPEC[band.key];
    const value = values[band.key];
    const step = (Math.PI * 2) / spec.count;
    const x = (band.x0 + band.x1) / 2;
    const first = Math.floor(value) - 1;
    return Array.from({ length: SLOTS }, (_, slot) => {
      const k = first + slot;
      const angle = READING + (k - value) * step;
      const { transform, facing } = bandTextAt(x, angle);
      const off = Math.min(1, Math.abs(k - value));
      const near = 1 - spec.dim * off;
      const edge = fade(1.6 - Math.abs(k - value), 0, 0.6);
      const opacity = Math.round(fade(facing, 0.12, 0.5) * near * edge * 100) / 100;
      return { text: spec.label(k), transform, opacity };
    });
  });
  return {
    carriage: drop ? translateAlong(P, [0, 0, -drop]) : "",
    card: translateAlong(P, [0, cardAt(t), 0]),
    inked: inkedAt(t),
    lowerStem: lowerStemOf(drop),
    upperStem: upperStemOf(drop),
    thumbRibs: thumbRibsOf(-(values.day - 1) * ((Math.PI * 2) / 30)),
    chars,
    readout: readoutOf(t),
  };
}
