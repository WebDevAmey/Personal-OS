"use client";

import * as React from "react";
import { Check, Lock, Mail, RotateCcw, Search } from "lucide-react";
import { cx as cn } from "@/components/ui/class-names";
import { useInView, useReducedMotion } from "./motion";

/*
 * Small looping scenes for the feature tiles. A tile plays its scene when it
 * first scrolls into view and again on hover. Scenes are decorative
 * (aria-hidden); each tile's caption carries the meaning.
 */

/** Restarts the scene (by key) on first view and on hover, at most once per second. */
const ART = { gauge: GaugeArt, command: CommandArt, undo: UndoArt, draft: DraftArt } as const;

export function Tile({ title, children, art, className }: { title: string; children: React.ReactNode; art: keyof typeof ART; className?: string }) {
  const Art = ART[art];
  const ref = React.useRef<HTMLElement>(null);
  const inView = useInView(ref, "0px 0px -15% 0px");
  const [run, setRun] = React.useState(0);
  const last = React.useRef(0);
  const replay = React.useCallback(() => {
    const now = Date.now();
    if (now - last.current < 1000) return;
    last.current = now;
    setRun((r) => r + 1);
  }, []);
  React.useEffect(() => {
    if (inView && run === 0) replay();
  }, [inView, run, replay]);

  return (
    <article
      ref={ref}
      onPointerEnter={replay}
      className={cn("group flex flex-col rounded-3xl bg-surface p-2 shadow-card transition-shadow duration-200 ease-out hover:shadow-card-hover", className)}
    >
      <div aria-hidden="true" className="tile-dots relative h-60 overflow-hidden rounded-2xl bg-surface-2 sm:h-64">
        {run > 0 ? <Art key={run} run={run} /> : <Art key="static" run={0} />}
      </div>
      <div className="px-4 pt-5 pb-5 text-center sm:px-6">
        <h3 className="text-heading text-foreground">{title}</h3>
        <div className="mx-auto mt-1.5 max-w-[42ch] text-body text-muted-foreground">{children}</div>
      </div>
    </article>
  );
}

function useCountUp(target: number, run: number, ms = 1100) {
  const reduced = useReducedMotion();
  const [n, setN] = React.useState(target);
  React.useEffect(() => {
    if (reduced || run === 0) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, run, ms, reduced]);
  return n;
}

/* 1 — a dial sweeping from 04:00 to 06:30, the briefing time. */
export function GaugeArt({ run }: { run: number }) {
  const read = useCountUp(43, run);
  const need = useCountUp(6, run, 1300);
  const arcLen = Math.PI * 80; // half circle, r = 80
  const ticks = Array.from({ length: 17 }, (_, i) => {
    const a = Math.PI + (Math.PI * i) / 16;
    const long = i % 4 === 0;
    const r1 = long ? 64 : 68;
    return { x1: 100 + r1 * Math.cos(a), y1: 100 + r1 * Math.sin(a), x2: 100 + 72 * Math.cos(a), y2: 100 + 72 * Math.sin(a), long };
  });
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      <svg viewBox="0 0 200 112" className="w-64 overflow-visible">
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--border)" strokeWidth="6" strokeLinecap="round" />
        <path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={arcLen}
          className="arc-fill"
          style={{ "--arc-len": arcLen, "--arc-to": arcLen * 0.375, strokeDashoffset: arcLen * 0.375 } as React.CSSProperties}
        />
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="var(--border-strong)" strokeOpacity={t.long ? 0.8 : 0.35} strokeWidth={t.long ? 1.5 : 1} />
        ))}
        {["04", "05", "06", "07", "08"].map((h, i) => {
          const a = Math.PI + (Math.PI * i) / 4;
          return (
            <text key={h} x={100 + 52 * Math.cos(a)} y={100 + 52 * Math.sin(a) + 3} textAnchor="middle" className="fill-subtle-foreground font-mono text-[8px]">
              {h}
            </text>
          );
        })}
        <g className="needle">
          <line x1="100" y1="100" x2="100" y2="34" stroke="var(--foreground)" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="100" r="6" fill="var(--surface)" stroke="var(--foreground)" strokeWidth="2.5" />
      </svg>
      <div className="mt-3 flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 font-mono text-meta text-muted-foreground shadow-card tabular-nums">
        <span className="size-1.5 rounded-full bg-success" />
        06:30 · {read} read · <span className="text-foreground">{need} need you</span>
      </div>
    </div>
  );
}

/* 2 — a sentence typed into the bar, then the exact date it resolved to. */
const SAY = "Move dentist to next Tue after lunch";
export function CommandArt({ run }: { run: number }) {
  const reduced = useReducedMotion();
  const [typed, setTyped] = React.useState(SAY.length);
  React.useEffect(() => {
    if (reduced || run === 0) return;
    setTyped(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= SAY.length) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [run, reduced]);
  const done = typed >= SAY.length;
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-3 px-6 sm:px-10">
      <div className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3.5 text-body text-foreground shadow-card">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {SAY.slice(0, typed)}
          {!done ? <span className="caret ml-px inline-block h-4 w-px translate-y-0.5 bg-foreground" /> : null}
        </span>
      </div>
      <div className={cn("space-y-2", done ? "" : "invisible")}>
        <div className={cn("flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-body-sm shadow-card", done && run > 0 && "rise-in")}>
          <Check className="size-3.5 text-success" strokeWidth={3} />
          <span className="text-foreground">
            Dentist → <span className="rounded bg-brand-subtle px-1 font-medium text-brand">Tue 3 Nov, 13:30</span>
          </span>
          <span className="ml-auto font-medium text-brand">Undo</span>
        </div>
        <p className={cn("px-1 font-mono text-meta text-muted-foreground", done && run > 0 && "rise-in [animation-delay:120ms]")}>
          “after lunch” = your lunch ends 13:00 → 13:30
        </p>
      </div>
    </div>
  );
}

/* 3 — an activity log; every row has Undo, and one gets undone. */
const LOG = [
  { who: "You", what: "Moved Q3 report to Thu", when: "now" },
  { who: "You", what: "Tagged 6 tasks #launch", when: "2m" },
  { who: "You", what: "Saved draft: Re: Offsite", when: "9m" },
  { who: "You", what: "Completed Book dentist", when: "1h" },
];
export function UndoArt({ run }: { run: number }) {
  const reduced = useReducedMotion();
  const [undone, setUndone] = React.useState(run === 0 || reduced);
  React.useEffect(() => {
    if (reduced || run === 0) return;
    setUndone(false);
    const id = setTimeout(() => setUndone(true), 1300);
    return () => clearTimeout(id);
  }, [run, reduced]);
  return (
    <div className="absolute inset-0 flex items-center justify-center px-5 sm:px-8">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-surface text-body-sm shadow-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 font-mono text-[0.6875rem] tracking-[0.06em] text-muted-foreground uppercase">
          <span>Activity</span>
          <span>Today</span>
        </div>
        <ul className="divide-y divide-border">
          {LOG.map((row, i) => {
            const isUndone = i === 1 && undone;
            return (
              <li key={row.what} className={cn("flex items-center gap-2.5 px-3 py-2", run > 0 && "rise-in")} style={run > 0 ? { animationDelay: `${i * 70}ms` } : undefined}>
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.625rem] font-medium text-muted-foreground">M</span>
                <span className={cn("min-w-0 flex-1 truncate transition-colors duration-300", isUndone ? "text-subtle-foreground line-through" : "text-foreground")}>{row.what}</span>
                {isUndone ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-1.5 py-px text-[0.6875rem] font-medium text-warning">
                    <RotateCcw className="size-3" />
                    Undone
                  </span>
                ) : (
                  <span className="font-mono text-[0.6875rem] text-subtle-foreground">{row.when}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* 4 — a reply written as a draft. The send button is not ours to press. */
export function DraftArt({ run }: { run: number }) {
  const animate = run > 0;
  return (
    <div className="absolute inset-0 flex items-center justify-center px-5 sm:px-8">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-surface text-body-sm shadow-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Mail className="size-3.5 text-muted-foreground" />
          <span className="truncate text-foreground">Re: Offsite dates</span>
          <span className="ml-auto shrink-0 rounded-full bg-surface-2 px-2 py-px text-[0.6875rem] text-muted-foreground">Draft · not sent</span>
        </div>
        <div className="space-y-2 px-3 py-3">
          <p className="text-muted-foreground">To Jordan Lee</p>
          {[92, 78, 54].map((w, i) => (
            <div key={w} className={cn("h-2 rounded-full bg-surface-2", animate && "grow-x")} style={{ width: `${w}%`, animationDelay: animate ? `${i * 140}ms` : undefined }} />
          ))}
          <svg viewBox="0 0 120 28" className="mt-1 h-6 w-24 text-foreground">
            <path
              d="M4 20 C 14 4, 20 4, 22 16 S 30 26, 36 12 S 46 4, 50 18 S 60 22, 66 10 C 70 4, 74 22, 82 14 S 98 8, 116 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              className={animate ? "draw" : ""}
              style={{ "--len": 220, animationDelay: animate ? "420ms" : undefined } as React.CSSProperties}
            />
          </svg>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Check className="size-3.5 text-success" strokeWidth={3} />
          <span className="text-foreground">Saved to Gmail drafts</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
            <Lock className="size-3" />
            You send it
          </span>
        </div>
      </div>
    </div>
  );
}
