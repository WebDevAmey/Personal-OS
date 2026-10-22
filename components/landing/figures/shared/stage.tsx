"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { LiveProps } from "./live-props";

/*
 * The interactive wrapper around a figure's server-rendered SVG. It renders
 * nothing of its own beyond the focusable stage, and loads the figure's live
 * module (a separate chunk) only when the plate comes within 200px of the
 * viewport. Under reduced motion it never starts the tour; it loads the live
 * module only once the reader points at or focuses the figure, and that
 * module then jumps straight to each target.
 */

const LIVE = {
  sorter: dynamic<LiveProps>(() => import("../sorter/live"), { ssr: false }),
  stamp: dynamic<LiveProps>(() => import("../stamp/live"), { ssr: false }),
  guard: dynamic<LiveProps>(() => import("../guard/live"), { ssr: false }),
};

export type FigureKind = keyof typeof LIVE;

const STILL = "(prefers-reduced-motion: reduce)";

type AriaProps = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "role" | "aria-label" | "aria-valuemin" | "aria-valuemax" | "aria-valuenow" | "aria-valuetext" | "aria-checked" | "aria-describedby"
>;

export function FigureStage({ kind, children, ...aria }: AriaProps & { kind: FigureKind; children: React.ReactNode }) {
  const root = React.useRef<HTMLDivElement>(null);
  const [load, setLoad] = React.useState(false);

  React.useEffect(() => {
    const node = root.current;
    if (!node || load) return;
    const still = window.matchMedia(STILL).matches;
    const wake = () => setLoad(true);
    if (still) {
      node.addEventListener("pointerenter", wake, { once: true });
      node.addEventListener("focus", wake, { once: true });
      return () => {
        node.removeEventListener("pointerenter", wake);
        node.removeEventListener("focus", wake);
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.at(-1)?.isIntersecting) return;
        observer.disconnect();
        const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
        if (idle) idle(wake, { timeout: 1200 });
        else window.setTimeout(wake, 200);
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [load]);

  /* The readout speaks only while the figure has focus. */
  React.useEffect(() => {
    const node = root.current;
    const readout = node?.closest(".iso-plate")?.querySelector("[data-readout]");
    if (!node || !readout) return;
    const on = () => readout.setAttribute("aria-live", "polite");
    const off = () => readout.removeAttribute("aria-live");
    node.addEventListener("focus", on);
    node.addEventListener("blur", off);
    return () => {
      node.removeEventListener("focus", on);
      node.removeEventListener("blur", off);
    };
  }, []);

  const Live = LIVE[kind];
  return (
    <div ref={root} className="fig-stage" tabIndex={0} {...aria}>
      {children}
      {load ? <Live root={root} /> : null}
    </div>
  );
}
