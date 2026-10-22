import type { SolidPaths } from "../kit/iso-kit";

/* Client-side writers for the nodes rendered by <LiveSolid>. They only touch
   an attribute when its value changes, so a settled frame costs nothing. */

export function setAttr(node: Element | null | undefined, name: string, value: string) {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export interface SolidNodes {
  root: SVGGElement;
  fill: SVGPathElement | null;
  shades: (SVGPathElement | null)[];
  top: SVGPathElement | null;
  crease: SVGPathElement | null;
  bevel: SVGPathElement | null;
  edge: SVGPathElement | null;
}

export function solidNodes(scope: ParentNode, name: string): SolidNodes | null {
  const root = scope.querySelector<SVGGElement>(`[data-k="${name}"]`);
  if (!root) return null;
  const part = (key: string) => root.querySelector<SVGPathElement>(`:scope > [data-p="${key}"]`);
  return {
    root,
    fill: part("fill"),
    shades: [0, 1, 2, 3].map((shade) => part(`shade${shade}`)),
    top: part("top"),
    crease: part("crease"),
    bevel: part("bevel"),
    edge: part("edge"),
  };
}

export function writeSolid(nodes: SolidNodes | null, paths: SolidPaths | null) {
  if (!nodes) return;
  setAttr(nodes.fill, "d", paths?.fill ?? "");
  nodes.shades.forEach((node, shade) => setAttr(node, "d", paths?.shades[shade] ?? ""));
  setAttr(nodes.top, "d", paths?.top ?? "");
  setAttr(nodes.crease, "d", paths?.crease ?? "");
  setAttr(nodes.bevel, "d", paths?.bevel ?? "");
  setAttr(nodes.edge, "d", paths?.outline ?? "");
}

export function setLit(node: Element | null | undefined, lit: boolean) {
  if (!node) return;
  if (lit && !node.hasAttribute("data-lit")) node.setAttribute("data-lit", "");
  if (!lit && node.hasAttribute("data-lit")) node.removeAttribute("data-lit");
}
