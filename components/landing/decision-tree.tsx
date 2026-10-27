"use client";

import * as React from "react";
import { ArrowRight, Archive, CheckCheck, Mail, PenLine, ShieldCheck, Tags, Trash2, Undo2, X } from "lucide-react";
import { cx as cn } from "@/components/ui/class-names";

/*
 * How confirmation feels, as a small interactive demo: three commands that
 * would be risky to run blind wait in a queue. Pick a branch (click, or 1–3
 * while the demo is hovered or focused), see the outcome, move on. It is a
 * demo only: nothing here talks to the app.
 */

type Tone = "success" | "neutral" | "danger" | "brand";

type Branch = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  suggested?: boolean;
  detail?: React.ReactNode;
  outcome: { tone: Tone; title: string; note: string };
};

type Decision = {
  risk: "Bulk" | "Destructive" | "External";
  command: string;
  context: string;
  stats: string;
  branches: Branch[];
};

const DECISIONS: Decision[] = [
  {
    risk: "Bulk",
    command: "Tag everything for the launch #launch",
    context: "Matches 6 open tasks across 2 projects.",
    stats: "6 tasks · 2 projects · reversible",
    branches: [
      { label: "Tag all 6", icon: Tags, suggested: true, outcome: { tone: "success", title: "Tagged 6 tasks #launch", note: "One Undo reverses all six." } },
      {
        label: "Let me pick",
        icon: CheckCheck,
        detail: <PickList />,
        outcome: { tone: "success", title: "Tagged 2 of 6", note: "The other four were left alone." },
      },
      { label: "Cancel", icon: X, outcome: { tone: "neutral", title: "Cancelled", note: "Nothing changed." } },
    ],
  },
  {
    risk: "Destructive",
    command: "Delete the Old website project",
    context: "The project still holds 14 tasks, 3 of them open.",
    stats: "1 project · 14 tasks",
    branches: [
      { label: "Archive instead", icon: Archive, suggested: true, outcome: { tone: "success", title: "Archived Old website", note: "Restore it any time from Projects." } },
      {
        label: "Delete it and its tasks",
        icon: Trash2,
        detail: <Warning>3 open tasks go with it: “Redirect old URLs”, “Export analytics”, “Cancel hosting”.</Warning>,
        outcome: { tone: "danger", title: "Deleted Old website", note: "Undo stays available in Activity." },
      },
      { label: "Keep it", icon: X, outcome: { tone: "neutral", title: "Kept", note: "Nothing changed." } },
    ],
  },
  {
    risk: "External",
    command: "Draft a reply to Jordan saying Thursday works",
    context: "Creates a Gmail draft to Jordan Lee. Nothing is sent.",
    stats: "1 draft · Gmail",
    branches: [
      { label: "Save as draft", icon: Mail, suggested: true, outcome: { tone: "brand", title: "Draft saved in Gmail", note: "Open Gmail to read it and send." } },
      {
        label: "Edit first",
        icon: PenLine,
        detail: <DraftPreview />,
        outcome: { tone: "brand", title: "Edited draft saved", note: "Still not sent. That part is yours." },
      },
      { label: "Cancel", icon: X, outcome: { tone: "neutral", title: "Cancelled", note: "No draft was created." } },
    ],
  },
];

const RISK_STYLE: Record<Decision["risk"], string> = {
  Bulk: "bg-warning-subtle text-warning",
  Destructive: "bg-danger-subtle text-danger",
  External: "bg-brand-subtle text-brand",
};

const TONE_STYLE: Record<Tone, { ring: string; icon: string; Icon: React.ComponentType<{ className?: string }> }> = {
  success: { ring: "shadow-[0_0_0_1px_color-mix(in_oklab,var(--success)_35%,transparent)]", icon: "bg-success-subtle text-success", Icon: CheckCheck },
  brand: { ring: "shadow-[0_0_0_1px_color-mix(in_oklab,var(--brand)_35%,transparent)]", icon: "bg-brand-subtle text-brand", Icon: Mail },
  danger: { ring: "shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_35%,transparent)]", icon: "bg-danger-subtle text-danger", Icon: Trash2 },
  neutral: { ring: "shadow-card", icon: "bg-surface-2 text-muted-foreground", Icon: X },
};

function PickList() {
  const rows = [
    { t: "Write launch post", on: true },
    { t: "Record demo video", on: true },
    { t: "Update pricing page", on: false },
    { t: "Email beta list", on: false },
  ];
  return (
    <ul className="divide-y divide-border rounded-xl bg-surface text-body-sm shadow-card">
      {rows.map((r) => (
        <li key={r.t} className="flex items-center gap-2.5 px-3 py-2">
          <span className={cn("grid size-4 place-items-center rounded border", r.on ? "border-brand bg-brand text-brand-foreground" : "border-border-strong")}>
            {r.on ? <CheckCheck className="size-3" /> : null}
          </span>
          <span className={r.on ? "text-foreground" : "text-muted-foreground"}>{r.t}</span>
        </li>
      ))}
    </ul>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-warning-subtle px-3 py-2.5 text-body-sm text-warning">{children}</p>;
}

function DraftPreview() {
  return (
    <div className="rounded-xl bg-surface p-3 text-body-sm shadow-card">
      <p className="text-meta text-muted-foreground">To Jordan Lee · Re: Offsite dates</p>
      <p className="mt-2 text-foreground">
        Hi Jordan, Thursday works for me. How about 2pm?<span className="caret ml-px inline-block h-3.5 w-px translate-y-0.5 bg-foreground" />
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] bg-surface px-1 font-mono text-[0.6875rem] text-muted-foreground shadow-[0_0_0_1px_var(--border),0_1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

export function DecisionTree() {
  const [index, setIndex] = React.useState(0);
  const [choice, setChoice] = React.useState<number | null>(null);
  const [active, setActive] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const done = index >= DECISIONS.length;
  const decision = DECISIONS[Math.min(index, DECISIONS.length - 1)];

  const next = React.useCallback(() => {
    if (choice === null) return;
    setChoice(null);
    setIndex((i) => i + 1);
  }, [choice]);

  const reset = () => {
    setIndex(0);
    setChoice(null);
  };

  React.useEffect(() => {
    if (!active || done) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const n = Number(event.key);
      if (choice === null && n >= 1 && n <= decision.branches.length) {
        event.preventDefault();
        setChoice(n - 1);
      } else if (choice !== null && (event.key === "ArrowRight" || event.key === "Enter")) {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, done, choice, decision, next]);

  const chosen = choice === null ? null : decision.branches[choice];
  const remaining = DECISIONS.length - index;

  return (
    <div
      ref={rootRef}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(rootRef.current?.contains(document.activeElement) ?? false)}
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
      }}
      className="overflow-hidden rounded-3xl bg-surface shadow-card"
    >
      {/* queue bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-brand-subtle text-brand">
            <ShieldCheck className="size-4" />
          </span>
          <span className="text-body font-semibold text-foreground">Waiting for you</span>
          <span className="text-body text-muted-foreground tabular-nums">{done ? "Queue empty" : `${remaining} in queue`}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden gap-1 sm:flex" aria-hidden="true">
            {DECISIONS.map((_, i) => (
              <span key={i} className={cn("h-1.5 rounded-full transition-[width,background-color] duration-200 ease-out", i === index ? "w-4 bg-foreground" : i < index ? "w-1.5 bg-success" : "w-1.5 bg-border")} />
            ))}
          </div>
          <span className="font-mono text-meta text-muted-foreground tabular-nums">{done ? `${DECISIONS.length} of ${DECISIONS.length}` : `${index + 1} of ${DECISIONS.length}`}</span>
        </div>
      </div>

      <div className="tile-dots relative min-h-[26rem] bg-surface-2/50 px-4 py-8 sm:px-8 sm:py-10">
        <p className="sr-only" aria-live="polite">
          {done ? "All decided." : chosen ? `${chosen.outcome.title}. ${chosen.outcome.note}` : ""}
        </p>

        {done ? (
          <div className="rise-in flex min-h-[20rem] flex-col items-center justify-center text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-success-subtle text-success">
              <CheckCheck className="size-7" />
            </span>
            <p className="mt-4 text-heading text-foreground">All decided</p>
            <p className="mt-1 max-w-xs text-body text-muted-foreground">Three changes, each one on your say-so. The small, reversible ones never waited at all.</p>
            <button
              type="button"
              onClick={reset}
              className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-4 text-body font-medium text-foreground shadow-card transition-[scale,box-shadow] duration-150 ease-out hover:shadow-card-hover active:scale-[0.97]"
            >
              <Undo2 className="size-4" />
              Run it again
            </button>
          </div>
        ) : (
          <div key={index} className="rise-in grid gap-8 lg:grid-cols-[17rem_14rem_minmax(0,1fr)] lg:items-start lg:gap-14">
            {/* root context */}
            <div className="relative rounded-2xl bg-surface p-4 shadow-card">
              <span className={cn("inline-flex rounded-full px-2 py-0.5 font-mono text-[0.625rem] tracking-[0.08em] uppercase", RISK_STYLE[decision.risk])}>{decision.risk}</span>
              <p className="mt-3 text-meta text-muted-foreground">You asked</p>
              <p className="mt-0.5 text-heading-sm font-semibold text-foreground">“{decision.command}”</p>
              <p className="mt-2 text-body-sm text-muted-foreground">{decision.context}</p>
              <p className="mt-3 border-t border-border pt-2.5 font-mono text-[0.6875rem] text-subtle-foreground">{decision.stats}</p>
              {/* connector to the branches */}
              <span aria-hidden="true" className="absolute top-1/2 -right-7 hidden h-px w-7 bg-border-strong/40 lg:block" />
            </div>

            {/* branches */}
            <ol className="relative space-y-2 pl-7 lg:pl-0" aria-label="Choose what happens">
              <span aria-hidden="true" className="absolute top-5 bottom-5 left-0 w-px bg-border-strong/40 lg:-left-7" />
              {decision.branches.map((branch, i) => {
                const isChosen = choice === i;
                const faded = choice !== null && !isChosen;
                const Icon = branch.icon;
                return (
                  <li key={branch.label} className={cn("relative transition-[opacity,translate] duration-150 ease-out", faded && "pointer-events-none -translate-x-1 opacity-0")}>
                    <span aria-hidden="true" className="absolute top-1/2 -left-7 h-px w-7 bg-border-strong/40" />
                    <button
                      type="button"
                      onClick={() => setChoice(i)}
                      disabled={choice !== null}
                      aria-pressed={isChosen}
                      className={cn(
                        "flex h-10 w-full items-center gap-2.5 rounded-xl bg-surface pr-3 pl-1.5 text-left text-body-sm font-medium text-foreground transition-[box-shadow,scale] duration-150 ease-out active:scale-[0.98] disabled:cursor-default",
                        isChosen ? "shadow-[0_0_0_1.5px_var(--brand),0_4px_12px_-6px_color-mix(in_oklab,var(--brand)_50%,transparent)]" : "shadow-card hover:shadow-card-hover",
                        branch.suggested && !isChosen && choice === null && "shadow-[0_0_0_1px_color-mix(in_oklab,var(--brand)_45%,transparent),0_1px_2px_rgb(0_0_0/0.04)]",
                      )}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 font-mono text-[0.6875rem] text-muted-foreground">{i + 1}</span>
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{branch.label}</span>
                      {branch.suggested ? <span className="shrink-0 font-mono text-[0.625rem] tracking-[0.06em] text-brand uppercase">Suggested</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* outcome */}
            <div className="relative min-h-10 pl-7 lg:pl-0">
              {chosen ? (
                <div className="rise-in space-y-3 lg:mt-[var(--offset)]" style={{ "--offset": `${(choice ?? 0) * 3}rem` } as React.CSSProperties}>
                  <span aria-hidden="true" className="absolute left-0 hidden h-px w-14 -translate-x-full bg-border-strong/40 lg:block" style={{ top: `calc(${(choice ?? 0) * 3}rem + 1.25rem)` }} />
                  {chosen.detail}
                  <div className={cn("flex items-start gap-3 rounded-2xl bg-surface p-3.5", TONE_STYLE[chosen.outcome.tone].ring)}>
                    {(() => {
                      const T = TONE_STYLE[chosen.outcome.tone];
                      return (
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", T.icon)}>
                          <T.Icon className="size-4" />
                        </span>
                      );
                    })()}
                    <div className="min-w-0 flex-1">
                      <p className="text-body-sm font-semibold text-foreground">{chosen.outcome.title}</p>
                      <p className="text-body-sm text-muted-foreground">{chosen.outcome.note}</p>
                    </div>
                    {chosen.outcome.tone !== "neutral" ? <span className="text-body-sm font-medium text-brand">Undo</span> : null}
                  </div>
                  <button
                    type="button"
                    onClick={next}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-body-sm font-medium text-background transition-[scale,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
                  >
                    {index + 1 < DECISIONS.length ? "Next decision" : "Finish"}
                    <ArrowRight className="size-3.5" />
                  </button>
                </div>
              ) : (
                <p className="hidden pt-2.5 text-body-sm text-subtle-foreground lg:block">Nothing happens until you pick.</p>
              )}
            </div>
          </div>
        )}

        {!done ? (
          <div className="mt-8 flex flex-wrap items-center gap-2 text-meta text-muted-foreground lg:absolute lg:bottom-5 lg:left-8 lg:mt-0">
            <span>{choice === null ? "Pick a branch" : "Continue"}</span>
            {choice === null ? (
              <>
                <Kbd>1</Kbd>
                <Kbd>2</Kbd>
                <Kbd>3</Kbd>
              </>
            ) : (
              <Kbd>→</Kbd>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
