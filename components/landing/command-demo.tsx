"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Check, Mic, Search } from "lucide-react";
import { Kbd, Panel } from "./mock";

/*
 * The command bar preview: the real example sentence (docs/00-product-spec.md
 * E12) and the two Done lines it produces. The server renders the finished
 * state, which is also what no-JS and reduced-motion readers see. If the demo
 * is below the fold when the page loads, it clears and types the sentence
 * once when it scrolls into view; the Done lines then arrive with Motion,
 * loaded only at that point.
 */

export const SENTENCE = "Move the thing I need to finish today to tomorrow and remind me about the recruiter email after lunch";

const STEP_MS = 28;

const DoneLines = dynamic(() => import("./done-lines"), { ssr: false });

function DoneLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 text-body-sm text-foreground">
      <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      <span className="shrink-0 font-medium text-brand">Undo</span>
    </div>
  );
}

const LINES = [
  <DoneLine key="move">
    Moved <em className="font-medium not-italic">Q3 report</em> → Thu 22 Oct
  </DoneLine>,
  <DoneLine key="remind">
    Reminder set for 1:00 PM today: <em className="font-medium not-italic">Reply to Jordan Lee</em>
  </DoneLine>,
];

export function CommandDemo() {
  const root = React.useRef<HTMLDivElement>(null);
  const [typed, setTyped] = React.useState(SENTENCE.length);
  const [replayed, setReplayed] = React.useState(false);

  React.useEffect(() => {
    const node = root.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (node.getBoundingClientRect().top < window.innerHeight) return;
    setTyped(0);
    setReplayed(true);
    let timer = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.at(-1)?.isIntersecting) return;
        observer.disconnect();
        let count = 0;
        const tick = () => {
          count += 1;
          setTyped(count);
          if (count < SENTENCE.length) timer = window.setTimeout(tick, STEP_MS);
        };
        timer = window.setTimeout(tick, 300);
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const done = typed >= SENTENCE.length;
  return (
    <div ref={root} aria-hidden="true">
      <Panel className="overflow-hidden shadow-popover">
        <div className="flex items-start gap-2.5 px-3 py-3">
          <Search className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="min-h-10 min-w-0 flex-1 text-body text-foreground">
            {SENTENCE.slice(0, typed)}
            {!done ? <span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-foreground" /> : null}
          </p>
          <span className="flex shrink-0 items-center gap-1.5">
            <Mic className="size-4 text-muted-foreground" />
            <Kbd>⌘K</Kbd>
          </span>
        </div>
        <div className="min-h-[4.75rem] divide-y divide-border border-t border-border">
          {!done ? null : replayed ? <DoneLines>{LINES}</DoneLines> : LINES}
        </div>
      </Panel>
    </div>
  );
}
