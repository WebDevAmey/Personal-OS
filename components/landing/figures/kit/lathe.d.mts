// Type declarations for the vendored lathe.mjs (written for Personal OS; the
// kit ships it as untyped JavaScript). Declaring it keeps the type checker
// from inferring types across the whole 1,200-line module.
import type { Projection, SolidPaths } from "./iso-kit";

export type Vec3 = [number, number, number];
export interface Frame {
  o: Vec3;
  a: Vec3;
  u: Vec3;
  v: Vec3;
}

export function viewOf(P: Projection): Vec3;
export function lightOf(P: Projection): Vec3;
export function frameOf(o: Vec3, a: Vec3, u: Vec3, v: Vec3): Frame;
export function frameAlong(o: Vec3, a: Vec3): Frame;
export function pointOf(F: Frame, s: number, r: number, angle: number): Vec3;
export function disc(s0: number, s1: number, r: number, F: Frame, P: Projection, options?: Record<string, unknown>): SolidPaths;
export function solidOf(profile: Array<[number, number] | [number, number, number]>, F: Frame, P: Projection, options?: Record<string, unknown>): SolidPaths;
export function prismOf(F: Frame, polygon: Array<[number, number]>, s0: number, s1: number, P: Projection): SolidPaths;
export function sphereOf(centre: Vec3, r: number, P: Projection, options?: { steps?: number }): SolidPaths;
