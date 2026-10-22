"use client";

import * as React from "react";
import { announcer, drive } from "../shared/drive";
import { setAttr, solidNodes, writeSolid } from "../shared/dom";
import type { LiveProps } from "../shared/live-props";
import { sceneAt } from "./frame";
import { END, STOPS, stageOf, spokenOf } from "./model";
import { BANDS } from "./view";

/* Fig 2, client side: rolls, presses and slides the server-rendered stamp. */

export default function StampLive({ root }: LiveProps) {
  React.useEffect(() => {
    const stage = root.current;
    const svg = stage?.querySelector("svg");
    if (!stage || !svg) return;
    const pick = (key: string) => svg.querySelector(`[data-k="${key}"]`);
    const movers = ["carriage", "knob", "thumb"].map(pick);
    const card = pick("card");
    const imprint = pick("imprint") as SVGGElement | null;
    const ribs = pick("thumbRibs");
    const lowerStem = solidNodes(svg, "lowerStem");
    const upperStem = solidNodes(svg, "upperStem");
    const chars = BANDS.map((band) => Array.from(pick(`chars-${band.key}`)?.children ?? []) as SVGTextElement[]);
    const announce = announcer(stage);

    return drive(stage, {
      end: END,
      stops: STOPS,
      hold: 3.2,
      render(t) {
        const scene = sceneAt(t);
        movers.forEach((node) => (scene.carriage ? setAttr(node, "transform", scene.carriage) : node?.removeAttribute("transform")));
        setAttr(card, "transform", scene.card);
        if (imprint) imprint.style.opacity = scene.inked ? "" : "0";
        setAttr(ribs, "d", scene.thumbRibs);
        writeSolid(lowerStem, scene.lowerStem);
        writeSolid(upperStem, scene.upperStem);
        scene.chars.forEach((slots, band) =>
          slots.forEach((slot, index) => {
            const node = chars[band]![index];
            if (!node) return;
            if (node.textContent !== slot.text) node.textContent = slot.text;
            setAttr(node, "transform", slot.transform);
            setAttr(node, "opacity", `${slot.opacity}`);
          }),
        );
        announce(scene.readout, stageOf(t), () => spokenOf(t));
      },
    });
  }, [root]);
  return null;
}
