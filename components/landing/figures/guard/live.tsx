"use client";

import * as React from "react";
import { announcer, drive } from "../shared/drive";
import { setAttr, setLit, solidNodes, writeSolid } from "../shared/dom";
import type { LiveProps } from "../shared/live-props";
import { sceneAt } from "./frame";
import { END, OFF, ON, OPEN, STOPS } from "./model";

/*
 * Fig 3, client side. Pointing at or focusing the panel lifts the cover;
 * clicking it, or Enter or Space, flips the switch; doing it again undoes.
 * Leaving closes the cover unless the change is applied.
 */

const EPS = 1e-3;

export default function GuardLive({ root }: LiveProps) {
  React.useEffect(() => {
    const stage = root.current;
    const svg = stage?.querySelector("svg");
    if (!stage || !svg) return;
    const pick = (key: string) => svg.querySelector(`[data-k="${key}"]`) as SVGElement | null;
    const covers = {
      front: { group: pick("coverFront"), body: solidNodes(svg, "coverFrontBody"), cavity: pick("coverFrontCavity") },
      back: { group: pick("coverBack"), body: solidNodes(svg, "coverBackBody"), cavity: pick("coverBackCavity") },
    };
    const bats = { plain: pick("batPlain"), clipped: pick("batClipped") };
    const clip = pick("clip");
    const shaft = solidNodes(svg, "shaft");
    const tip = solidNodes(svg, "tip");
    const lamp = pick("lamp");
    const lens = lamp?.querySelector(".iso-solid") ?? null;
    const announce = announcer(stage);
    const show = (node: SVGElement | null, on: boolean) => {
      if (node && (node.style.display === "none") === on) node.style.display = on ? "" : "none";
    };

    return drive(stage, {
      end: END,
      stops: STOPS,
      hold: 2.4,
      scrub: false,
      render(t) {
        const scene = sceneAt(t);
        (["front", "back"] as const).forEach((slot) => {
          const on = scene.coverSlot === slot;
          show(covers[slot].group, on);
          if (!on) return;
          writeSolid(covers[slot].body, scene.cover);
          setAttr(covers[slot].cavity, "d", scene.cavity);
        });
        setAttr(clip, "d", scene.clip);
        (["plain", "clipped"] as const).forEach((slot) => show(bats[slot], scene.batSlot === slot));
        writeSolid(shaft, scene.shaft);
        writeSolid(tip, scene.tip);
        if (lamp) {
          if (scene.lit) lamp.setAttribute("data-on", "");
          else lamp.removeAttribute("data-on");
        }
        setLit(lens, scene.lit);
        announce(scene.readout);
        setAttr(stage, "aria-checked", scene.lit ? "true" : "false");
      },
      attach({ input, jump, target }) {
        const lift = () => {
          const at = target();
          if (at <= ON[0]) input(OPEN[1]);
          else if (at >= OFF[1] - EPS) input(OFF[1]);
        };
        const lower = () => {
          if (stage.contains(document.activeElement) || stage.matches(":hover")) return;
          const at = target();
          if (at <= ON[0]) input(0);
          else if (at >= OFF[1] - EPS) input(END);
        };
        const activate = () => {
          const at = target();
          if (at < ON[1] - EPS) input(ON[1]);
          else if (at < OFF[1] - EPS) input(OFF[1]);
          else {
            jump(OPEN[1]);
            input(ON[1]);
          }
        };
        const onKey = (event: KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate();
        };
        const onLeave = () => window.setTimeout(lower, 0);
        stage.addEventListener("pointerenter", lift);
        stage.addEventListener("focus", lift);
        stage.addEventListener("pointerleave", onLeave);
        stage.addEventListener("blur", onLeave);
        stage.addEventListener("click", activate);
        stage.addEventListener("keydown", onKey);
        if (stage.matches(":hover") || document.activeElement === stage) lift();
        return () => {
          stage.removeEventListener("pointerenter", lift);
          stage.removeEventListener("focus", lift);
          stage.removeEventListener("pointerleave", onLeave);
          stage.removeEventListener("blur", onLeave);
          stage.removeEventListener("click", activate);
          stage.removeEventListener("keydown", onKey);
        };
      },
    });
  }, [root]);
  return null;
}
