"use client";

import * as React from "react";
import { CalendarDays, Check, Inbox, ListTodo, Mail, Search, Sun, CalendarClock, FolderClosed } from "lucide-react";
import { cx as cn } from "@/components/ui/class-names";
import { useInView, useReducedMotion } from "./motion";

/*
 * The hero's product window: a morning briefing filling in, then one command
 * moving a task. It loops only while on screen. Server render, no-JS and
 * reduced motion all show the finished state, so nothing depends on the
 * animation. The whole window is decorative (aria-hidden); the hero copy says
 * the same thing in words.
 */

const COMMAND = "Move the report to Thursday";

type Item = {
  id: string;
  title: string;
  detail: string;
  source: { icon: React.ComponentType<{ className?: string }>; label: string };
  dot: string;
  inferred?: boolean;
};

const ITEMS: Item[] = [
  { id: "report", title: "Finish the Q3 report", detail: "Due today · High", source: { icon: ListTodo, label: "Task" }, dot: "bg-priority-high" },
  {
    id: "jordan",
    title: "Reply to Jordan about the offsite",
    detail: "Unread since Tue; asks for two dates in November.",
    source: { icon: Mail, label: "Gmail · “Offsite dates”" },
    dot: "bg-border-strong",
    inferred: true,
  },
  { id: "review", title: "Design review at 10:00", detail: "First meeting today; agenda in the invite.", source: { icon: CalendarDays, label: "Calendar · 10:00–10:45" }, dot: "bg-brand" },
  { id: "passport", title: "Renew passport", detail: "Overdue by 3 days", source: { icon: ListTodo, label: "Task" }, dot: "bg-priority-urgent" },
];

// Timeline: 0 empty, 1–4 items arrive, 5 typing, 6 moved, then hold and loop.
const FINAL = 6;

function useTimeline(active: boolean, reduced: boolean) {
  const [step, setStep] = React.useState(FINAL);
  const [typed, setTyped] = React.useState(COMMAND.length);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (reduced || !active) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => !cancelled && fn(), ms));

    const run = () => {
      setStep(0);
      setTyped(0);
      let t = started.current ? 200 : 500;
      started.current = true;
      for (let i = 1; i <= ITEMS.length; i++) at((t += 380), () => setStep(i));
      at((t += 900), () => setStep(5));
      for (let c = 1; c <= COMMAND.length; c++) at((t += 38), () => setTyped(c));
      at((t += 450), () => setStep(FINAL));
      at((t += 3800), run);
    };
    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [active, reduced]);

  return { step: reduced ? FINAL : step, typed: reduced ? COMMAND.length : typed };
}

function Starburst({ show }: { show: boolean }) {
  // Twelve points around a circle, alternating radius.
  const points = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 === 0 ? 50 : 42;
    const a = (Math.PI * 2 * i) / 24;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <div className={cn("absolute -top-7 -right-3 z-20 size-24 sm:-top-9 sm:-right-8 sm:size-28", show ? "pop-in" : "opacity-0")} style={{ rotate: "-6deg" }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full drop-shadow-[0_6px_14px_rgb(0_0_0/0.25)]">
        <polygon points={points} fill="#fde68a" />
      </svg>
      <div className="relative flex size-full flex-col items-center justify-center text-center text-[#3b1a07]">
        <span className="font-mono text-[0.625rem] tracking-[0.08em] uppercase">Ready</span>
        <span className="font-serif text-[1.65rem] leading-none tabular-nums sm:text-[1.9rem]">06:31</span>
      </div>
    </div>
  );
}

export function BriefingWindow() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const { step, typed } = useTimeline(inView, reduced);
  const moved = step >= FINAL;
  const typing = step === 5;

  return (
    <div ref={ref} aria-hidden="true" className="relative mx-auto w-full max-w-5xl">
      <Starburst show={step >= 1} />
      <div className="overflow-hidden rounded-2xl bg-surface shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_30px_80px_-20px_rgb(40_12_0/0.55),0_12px_24px_-12px_rgb(0_0_0/0.3)]">
        {/* chrome */}
        <div className="flex h-10 items-center gap-3 border-b border-border bg-surface-2/70 px-4">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="mx-auto flex h-6 w-full max-w-xs items-center justify-center rounded-md bg-surface px-3 font-mono text-[0.6875rem] text-muted-foreground shadow-card">
            personal-os.app/today
          </div>
          <div className="w-10" />
        </div>

        <div className="grid min-h-[22rem] grid-cols-1 sm:grid-cols-[13rem_minmax(0,1fr)] sm:min-h-[26rem]">
          {/* sidebar */}
          <div className="hidden flex-col gap-0.5 border-r border-border bg-surface-2/50 p-3 text-body-sm sm:flex">
            {[
              { icon: Sun, label: "Today", count: "4", active: true },
              { icon: Inbox, label: "Inbox", count: "2" },
              { icon: CalendarClock, label: "Upcoming" },
              { icon: FolderClosed, label: "Projects" },
            ].map(({ icon: Icon, label, count, active }) => (
              <div key={label} className={cn("flex h-8 items-center gap-2 rounded-md px-2", active ? "bg-surface text-foreground shadow-card" : "text-muted-foreground")}>
                <Icon className="size-4" />
                <span className="flex-1">{label}</span>
                {count ? <span className="font-mono text-meta tabular-nums">{count}</span> : null}
              </div>
            ))}
            <p className="mt-5 px-2 font-mono text-[0.625rem] tracking-[0.08em] text-subtle-foreground uppercase">Today</p>
            {["Stand-up notes", "Book dentist", "Expense receipts"].map((task, i) => (
              <div key={task} className="flex h-7 items-center gap-2 px-2 text-muted-foreground">
                <span className={cn("grid size-3.5 place-items-center rounded-full border", i === 0 ? "border-success bg-success text-white" : "border-border-strong")}>
                  {i === 0 ? <Check className="size-2.5" strokeWidth={3} /> : null}
                </span>
                <span className={cn(i === 0 && "line-through decoration-border-strong")}>{task}</span>
              </div>
            ))}
          </div>

          {/* main */}
          <div className="relative flex min-w-0 flex-col p-4 sm:p-6">
            <div className="flex h-9 items-center gap-2 rounded-lg bg-surface-2 px-3 text-body-sm text-muted-foreground">
              <Search className="size-3.5 shrink-0" />
              {typed > 0 && (typing || moved) ? (
                <span className="truncate text-foreground">
                  {COMMAND.slice(0, typed)}
                  {typing ? <span className="caret ml-px inline-block h-3.5 w-px translate-y-0.5 bg-foreground" /> : null}
                </span>
              ) : (
                <span className="truncate">Search, ask or tell Personal OS…</span>
              )}
              <kbd className="ml-auto rounded border border-border bg-surface px-1 font-mono text-[0.625rem]">⌘K</kbd>
            </div>

            <div className="mt-5 flex items-baseline justify-between gap-3">
              <p className="text-heading text-foreground">Good morning, Maya</p>
              <p className="font-mono text-meta text-muted-foreground tabular-nums">Prepared 06:31</p>
            </div>

            <ul className="mt-3 divide-y divide-border">
              {ITEMS.map((item, index) => {
                const shown = step >= index + 1;
                const isReport = item.id === "report";
                const Icon = item.source.icon;
                return (
                  <li key={item.id} className={cn("py-2.5", shown ? "rise-in" : "opacity-0")} style={shown ? { animationDelay: "0ms" } : undefined}>
                    <div className="flex items-center gap-2">
                      <span className={cn("size-1.5 shrink-0 rounded-full", item.dot)} />
                      <span className="truncate text-body-sm font-medium text-foreground">{item.title}</span>
                      {item.inferred ? (
                        <span className="shrink-0 rounded border border-dashed border-border-strong px-1 text-[0.625rem] text-muted-foreground">Inferred</span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-3.5">
                      <span
                        className={cn(
                          "text-body-sm transition-colors duration-300",
                          isReport && moved ? "rounded bg-brand-subtle px-1 font-medium text-brand" : "text-muted-foreground",
                        )}
                      >
                        {isReport && moved ? "Due Thu 29 Oct · High" : item.detail}
                      </span>
                      <span className="hidden items-center gap-1 rounded border border-border px-1.5 py-px text-[0.6875rem] text-muted-foreground md:inline-flex">
                        <Icon className="size-3" />
                        {item.source.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div
              className={cn(
                "absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-body-sm text-background shadow-popover sm:inset-x-auto sm:right-6 sm:bottom-6",
                moved ? "rise-in" : "opacity-0",
              )}
            >
              <Check className="size-3.5 text-success" strokeWidth={3} />
              <span>
                Moved <span className="font-medium">Q3 report</span> to Thu 29 Oct
              </span>
              <span className="ml-2 font-medium text-[#a5b8ff]">Undo</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
