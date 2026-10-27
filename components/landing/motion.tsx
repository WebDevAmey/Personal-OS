"use client";

import * as React from "react";

/*
 * Section reveal for the landing page (docs/07 §10.2): 8 px rise + fade,
 * 240 ms, once, started by an IntersectionObserver. Plain CSS so the landing
 * route carries no animation engine up front; Motion is loaded only for the
 * command bar demo (see done-lines.tsx). Without JavaScript a <noscript> style
 * in app/page.tsx shows everything; under reduced motion the global guard in
 * globals.css removes the transition and the rise.
 */

export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setShown(true);
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-reveal={shown ? "shown" : "pending"} className={className} style={delay ? { transitionDelay: `${delay}s` } : undefined}>
      {children}
    </div>
  );
}

/** True when the user asked for less motion, by system setting or by the in-app preference (`.reduce-motion` on <html>). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches || document.documentElement.classList.contains("reduce-motion"));
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Tracks whether an element is on screen, so looping demos only run while someone can see them. */
export function useInView<T extends Element>(ref: React.RefObject<T | null>, rootMargin = "0px"): boolean {
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)), { rootMargin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return inView;
}
