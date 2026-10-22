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
