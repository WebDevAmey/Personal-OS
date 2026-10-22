"use client";

import * as React from "react";
import { announcer, drive } from "../shared/drive";
import { setAttr, solidNodes, writeSolid } from "../shared/dom";
import type { LiveProps } from "../shared/live-props";
import { sceneAt, type CardSlot } from "./frame";
import { DECIDED_AT, END, countsAt, spokenOf } from "./model";

/* Fig 1, client side: rewrites the server-rendered desk for any time t. */

function writeSlots(group: Element | null, slots: (CardSlot | null)[]) {
  if (!group) return;
  const uses = group.children;
  slots.forEach((slot, index) => {
    const use = uses[index] as SVGUseElement | undefined;
    if (!use) return;
    if (!slot) {
      if (use.style.display !== "none") use.style.display = "none";
      return;
    }
    if (use.style.display) use.style.display = "";
    setAttr(use, "href", slot.href);
    setAttr(use, "transform", slot.transform);
    if (slot.opacity) setAttr(use, "opacity", slot.opacity);
    else if (use.hasAttribute("opacity")) use.removeAttribute("opacity");
  });
}

export default function SorterLive({ root }: LiveProps) {
  React.useEffect(() => {
    const stage = root.current;
    const svg = stage?.querySelector("svg");
    if (!stage || !svg) return;
    const paddle = solidNodes(svg, "paddle");
    const stack = solidNodes(svg, "stack");
    const pile = solidNodes(svg, "pile");
    const stackSeams = svg.querySelector('[data-k="stackSeams"]');
    const pileSeams = svg.querySelector('[data-k="pileSeams"]');
    const slats = svg.querySelector('[data-k="slats"]');
    const groups = {
      belt: svg.querySelector('[data-k="belt"]'),
      out: svg.querySelector('[data-k="out"]'),
      bin: svg.querySelector('[data-k="bin"]'),
    };
    const announce = announcer(stage);

    return drive(stage, {
      end: END,
      stops: DECIDED_AT,
      render(t) {
        const scene = sceneAt(t);
        writeSolid(paddle, scene.paddle);
        writeSolid(stack, scene.stack.paths);
        setAttr(stackSeams, "d", scene.stack.seams);
        writeSolid(pile, scene.pile.paths);
        setAttr(pileSeams, "d", scene.pile.seams);
        setAttr(slats, "d", scene.slats);
        writeSlots(groups.belt, scene.cards.belt);
        writeSlots(groups.out, scene.cards.out);
        writeSlots(groups.bin, scene.cards.bin);
        announce(scene.readout, countsAt(t).seen, () => spokenOf(t));
      },
    });
  }, [root]);
  return null;
}
