"use client";
// components/briefing/briefing-panel.tsx — the morning briefing on Today
// (docs/07 §11.3, FR-301..FR-312): items with always-visible sources, fact
// vs Inferred labelling, freshness / stale / partial indicators, and the
// preparing state that polls every 3 s for up to 90 s.
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { m } from "motion/react";
import {
  BookMarked,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Sparkles,
  SquareCheck,
} from "lucide-react";
import type {
  BriefingItem,
  BriefingSource,
  TodayBriefing,
} from "@/lib/briefing/types";
import type { IntegrationState } from "@/components/settings/types";
import type { LocalDateTime } from "@/components/tasks/types";
import { useOptionalApp } from "@/components/app/app-context";
import { cn } from "@/components/app/cn";
import { ConnectGoogleLink } from "@/components/app/connect-google-link";
import { notify } from "@/components/app/toast";
import { dueText } from "@/components/tasks/format";
import {
  usePalette,
  usePaletteSuggestions,
} from "@/components/command/palette-provider";

export const POLL_INTERVAL_MS = 3_000;
export const POLL_LIMIT_MS = 90_000;

/** Current state of tasks the briefing cites, for live reconciliation. */
export type TaskStateMap = Record<
  string,
  { status: string; due: LocalDateTime | null; deleted: boolean }
>;

export interface BriefingPanelProps {
  result: TodayBriefing;
  today: string;
  google: IntegrationState;
  taskStates: TaskStateMap;
}

const SOURCE_NAMES: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Google Calendar",
  memory: "Memory",
  tasks: "Tasks",
};

function formatClock(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

export function BriefingPanel({
  result,
  today,
  google,
  taskStates,
}: BriefingPanelProps) {
  const app = useOptionalApp();
  const headingId = useId();
  const { status, briefing } = result;
  const items = briefing?.items ?? [];
  const isToday = briefing?.localDate === today;
  usePaletteSuggestions(
    items
      .map((i) => i.suggestedCommand)
      .filter((s): s is string => Boolean(s))
      .slice(0, 3),
  );

  const prepared = briefing
    ? formatClock(briefing.generatedAt, app?.timeZone)
    : null;
  const partial = briefing?.partialSources.filter((s) => s !== "tasks") ?? [];
  const googleMissing = google === "not_connected";
  const googleBroken = google === "needs_reconnect";

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h2 id={headingId} className="text-heading-sm text-foreground">
          Needs attention
        </h2>
        <div className="ml-auto flex items-center gap-2 text-meta text-subtle-foreground">
          {status === "preparing" ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />{" "}
              Preparing…
            </span>
          ) : prepared ? (
            <span>
              {isToday ? "Prepared" : "From"}{" "}
              {isToday
                ? prepared
                : new Date(briefing!.generatedAt).toLocaleDateString(
                    undefined,
                    { weekday: "short", day: "numeric", month: "short" },
                  )}
            </span>
          ) : null}
          {(status === "ready" || status === "failed") && (
            <RefreshButton subtle={status === "ready" && !briefing?.isStale} />
          )}
        </div>
      </div>

      <div
        className="flex flex-col gap-3 p-4"
        aria-live="polite"
        aria-busy={status === "preparing"}
      >
        {googleMissing && <ConnectGoogleCard />}
        {googleBroken && (
          <Banner
            tone="warning"
            action={
              <ConnectGoogleLink className={bannerBtn}>
                Reconnect Google
              </ConnectGoogleLink>
            }
          >
            Google access expired, so email and calendar items are missing.
          </Banner>
        )}
        {status === "ready" && partial.length > 0 && !googleBroken && (
          <Banner tone="warning" action={<RefreshButton label="Retry" />}>
            {partial.map((s) => SOURCE_NAMES[s] ?? s).join(" and ")}{" "}
            couldn&rsquo;t be reached at {prepared} — those items are missing.
          </Banner>
        )}
        {briefing?.isStale && status !== "preparing" && (
          <Banner tone="neutral">
            {isToday
              ? `This briefing was prepared at ${prepared} and may be out of date.`
              : "Today’s briefing isn’t ready, so this is the most recent one."}
          </Banner>
        )}
        {status === "failed" && (
          <Banner tone="danger" action={<RefreshButton label="Try again" />}>
            Couldn&rsquo;t prepare today&rsquo;s briefing.
            {briefing ? " Showing the last one." : ""} Your tasks are below.
          </Banner>
        )}
        {status === "preparing" && (
          <Preparing hasPrevious={Boolean(briefing)} />
        )}

        {items.length > 0 && (status !== "preparing" || briefing) ? (
          <ol
            className={cn(
              "flex flex-col divide-y divide-border",
              status === "preparing" && "opacity-60",
            )}
          >
            {items.map((item, i) => (
              <BriefingRow
                key={item.id}
                item={item}
                index={i}
                today={today}
                taskStates={taskStates}
              />
            ))}
          </ol>
        ) : status === "ready" || (status === "none" && !briefing) ? (
          <div className="flex flex-col items-start gap-1 py-2">
            <p className="text-body text-foreground">
              Nothing needs you right now.
            </p>
            <p className="text-body-sm text-muted-foreground">
              Capture something with <kbd className="font-mono">C</kbd>, or ask
              anything with <kbd className="font-mono">⌘K</kbd>.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const bannerBtn =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-meta font-medium text-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";

function Banner({
  tone,
  children,
  action,
}: {
  tone: "warning" | "danger" | "neutral";
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-3 py-2 text-body-sm text-foreground",
        tone === "warning" && "bg-warning-subtle",
        tone === "danger" && "bg-danger-subtle",
        tone === "neutral" && "bg-surface-2 text-muted-foreground",
      )}
    >
      <CircleAlert
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          tone === "warning"
            ? "text-warning"
            : tone === "danger"
              ? "text-danger"
              : "text-subtle-foreground",
        )}
      />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

function ConnectGoogleCard() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border-strong px-3 py-3">
      <div className="flex -space-x-1" aria-hidden>
        <span className="grid size-7 place-items-center rounded-full border border-border bg-background">
          <Mail className="size-3.5 text-subtle-foreground" />
        </span>
        <span className="grid size-7 place-items-center rounded-full border border-border bg-background">
          <CalendarDays className="size-3.5 text-subtle-foreground" />
        </span>
      </div>
      <p className="min-w-0 flex-1 text-body-sm text-foreground">
        Connect Google to include email and calendar.
        <span className="block text-meta text-muted-foreground">
          Read-only for mail and calendar; drafts are only created when you
          confirm.
        </span>
      </p>
      <ConnectGoogleLink className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-body font-medium text-brand-foreground hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Connect
      </ConnectGoogleLink>
    </div>
  );
}

function Preparing({ hasPrevious }: { hasPrevious: boolean }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const routerRef = useRef(router);
  routerRef.current = router;
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started >= POLL_LIMIT_MS) {
        window.clearInterval(id);
        setTimedOut(true);
        return;
      }
      routerRef.current.refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  if (timedOut) {
    return (
      <Banner
        tone="neutral"
        action={
          <button
            type="button"
            className={bannerBtn}
            onClick={() => router.refresh()}
          >
            Check again
          </button>
        }
      >
        This is taking longer than usual. Your tasks are below; the briefing
        will appear when it&rsquo;s ready.
      </Banner>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-3">
      <p className="text-body-sm text-muted-foreground">
        Preparing your briefing…{" "}
        {hasPrevious
          ? "The last one is shown meanwhile."
          : "Your tasks are below."}
      </p>
      {!hasPrevious &&
        [0.9, 0.7, 0.8].map((w, i) => (
          <div key={i} className="flex flex-col gap-1.5" aria-hidden>
            <div
              className="h-4 animate-pulse rounded bg-surface-2 motion-reduce:animate-none"
              style={{ width: `${w * 60}%` }}
            />
            <div
              className="h-3 animate-pulse rounded bg-surface-2 motion-reduce:animate-none"
              style={{ width: `${w * 85}%` }}
            />
          </div>
        ))}
    </div>
  );
}

function RefreshButton({
  label,
  subtle,
}: {
  label?: string;
  subtle?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (subtle) return null; // FR-311: no regenerate of a fresh, successful briefing.
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/briefing/today/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
        retryAfterSeconds?: number;
      };
      if (res.status === 202 || body.code === "BRIEFING_RUNNING") {
        router.refresh();
      } else if (body.code === "BRIEFING_FRESH") {
        notify({ title: "Your briefing is already up to date" });
        router.refresh();
      } else if (res.status === 429) {
        const mins = body.retryAfterSeconds
          ? Math.ceil(body.retryAfterSeconds / 60)
          : null;
        notify({
          title:
            body.code === "BRIEFING_RETRIES_EXHAUSTED"
              ? "No more refreshes today"
              : "Refreshed recently",
          description: mins ? `Try again in ${mins} min.` : undefined,
        });
      } else if (!res.ok) {
        notify({
          title: "Couldn't refresh the briefing",
          description: body.error,
          tone: "error",
        });
      }
    } catch {
      notify({
        title: "Couldn't refresh the briefing",
        description: "Check your connection.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className={bannerBtn}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw aria-hidden className="size-3.5" />
      )}
      {label ?? "Refresh"}
    </button>
  );
}

const PRIORITY_DOT: Record<BriefingItem["priority"], string> = {
  high: "bg-priority-urgent",
  medium: "bg-priority-medium",
  low: "border border-border-strong bg-transparent",
};

function BriefingRow({
  item,
  index,
  today,
  taskStates,
}: {
  item: BriefingItem;
  index: number;
  today: string;
  taskStates: TaskStateMap;
}) {
  const palette = usePalette();
  const inferredId = useId();
  const taskSource = item.sources.find((s) => s.type === "task");
  const current = taskSource ? taskStates[taskSource.id] : undefined;
  const done = current?.status === "DONE";
  const gone = current?.deleted || current?.status === "CANCELLED";
  return (
    <m.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index, 6) * 0.04 }}
      className="flex gap-3 py-3 first:pt-0 last:pb-0"
    >
      <span
        aria-hidden
        className={cn(
          "mt-[7px] size-2 shrink-0 rounded-full",
          PRIORITY_DOT[item.priority],
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3
            className={cn(
              "text-body font-medium text-foreground",
              (done || gone) && "text-subtle-foreground line-through",
            )}
          >
            {item.title}
          </h3>
          <span className="sr-only">, {item.priority} priority</span>
          {item.isInferred && (
            <>
              <span
                aria-describedby={inferredId}
                className="inline-flex h-5 items-center rounded-sm border border-dashed border-border-strong px-1.5 text-meta text-muted-foreground"
              >
                Inferred
              </span>
              <span id={inferredId} className="sr-only">
                Personal OS concluded this from the sources below; check before
                relying on it.
              </span>
            </>
          )}
          {done && (
            <span className="inline-flex items-center gap-1 text-meta text-success">
              <CircleCheck aria-hidden className="size-3.5" /> Done since
              briefing
            </span>
          )}
          {!done && gone && (
            <span className="text-meta text-subtle-foreground">
              Removed since briefing
            </span>
          )}
          {!done &&
            !gone &&
            current?.due &&
            current.due.date !== today &&
            item.kind === "task" && (
              <span className="text-meta text-subtle-foreground">
                Moved to {dueText(current.due, today)}
              </span>
            )}
        </div>
        {item.reason && (
          <p className="mt-0.5 text-body-sm text-muted-foreground">
            {item.reason}
          </p>
        )}
        <ul aria-label="Sources" className="mt-1.5 flex flex-wrap gap-1.5">
          {item.sources.map((s) => (
            <li key={`${s.type}:${s.id}`}>
              <SourceChip source={s} />
            </li>
          ))}
        </ul>
      </div>
      {item.suggestedCommand && !done && !gone && (
        <button
          type="button"
          onClick={() => palette.openWith(item.suggestedCommand!)}
          title={item.suggestedCommand}
          className="hidden h-7 shrink-0 items-center gap-1.5 self-start rounded-md border border-border bg-background px-2 text-meta text-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring sm:inline-flex"
        >
          <Sparkles aria-hidden className="size-3.5 text-subtle-foreground" />
          <span className="max-w-44 truncate">{item.suggestedCommand}</span>
        </button>
      )}
    </m.li>
  );
}

const chipCls =
  "inline-flex h-6 max-w-72 items-center gap-1 rounded-sm bg-surface-2 px-1.5 text-meta text-muted-foreground hover:bg-border hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

function SourceChip({ source }: { source: BriefingSource }) {
  const app = useOptionalApp();
  const label = <span className="truncate">{source.label}</span>;
  switch (source.type) {
    case "task":
      return (
        <button
          type="button"
          className={chipCls}
          onClick={() => app?.openTask(source.id)}
          aria-label={`Task: ${source.label}`}
        >
          <SquareCheck aria-hidden className="size-3.5 shrink-0" />
          {label}
        </button>
      );
    case "email":
      return (
        <a
          className={chipCls}
          href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(source.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Gmail: ${source.label} (opens in a new tab)`}
        >
          <Mail aria-hidden className="size-3.5 shrink-0" />
          {label}
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
      );
    case "event":
      return (
        <a
          className={chipCls}
          href="https://calendar.google.com/calendar/r/day"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Calendar: ${source.label} (opens in a new tab)`}
        >
          <CalendarDays aria-hidden className="size-3.5 shrink-0" />
          {label}
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
      );
    case "memory":
      return (
        <a
          className={chipCls}
          href="/memory"
          aria-label={`Memory: ${source.label}`}
        >
          <BookMarked aria-hidden className="size-3.5 shrink-0" />
          {label}
        </a>
      );
  }
}
