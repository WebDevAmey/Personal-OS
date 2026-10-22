import * as React from "react";
import type { SolidPaths, Tone } from "../kit/iso-kit";

/*
 * A kit solid whose paths the live code can rewrite in place. It renders the
 * same structure as the kit's <Solid> (fill, four shades, top, crease, bevel,
 * outline), with `data-p` on each path so `writeSolid` can find them. Used for
 * parts whose shape changes as the figure runs (a paddle turning, a stack
 * getting shorter).
 */

const EMPTY: SolidPaths = { fill: "", outline: "", crease: "", top: "", shades: ["", "", "", ""], bevel: "" };

export function LiveSolid({
  name,
  paths,
  tone = "mid",
  crease = "faint",
  lit = false,
  className,
  children,
}: {
  name: string;
  paths: SolidPaths | null;
  tone?: Tone;
  crease?: Tone;
  lit?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const p = paths ?? EMPTY;
  return (
    <g data-k={name} className={className ? `iso-solid ${className}` : "iso-solid"} data-lit={lit ? "" : undefined} data-seamless={p.seamless ? "" : undefined}>
      <path data-p="fill" className="iso-fill" d={p.fill} />
      {[0, 1, 2, 3].map((shade) => (
        <path key={shade} data-p={`shade${shade}`} className="iso-shade" data-shade={shade} d={p.shades[shade] ?? ""} />
      ))}
      <path data-p="top" className="iso-top" d={p.top} />
      <path data-p="crease" className="iso-line iso-crease" data-tone={crease} d={p.crease} />
      <path data-p="bevel" className="iso-line iso-bevel" data-tone={crease} d={p.bevel ?? ""} />
      {children}
      <path data-p="edge" className="iso-line iso-edge" data-tone={tone} d={p.outline} />
    </g>
  );
}
