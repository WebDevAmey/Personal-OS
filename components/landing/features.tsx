import * as React from "react";
import { Bookmark, CalendarDays, Check, FileText, ListTodo, Mail, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cx as cn } from "@/components/ui/class-names";
import { CommandDemo, SENTENCE } from "./command-demo";
import { Kbd, Panel, SourceChip, Token } from "./mock";
import { Reveal } from "./motion";
import { SectionHeading } from "./section-heading";

function Feature({ title, children, preview, className }: { title: string; children: React.ReactNode; preview: React.ReactNode; className?: string }) {
  return (
    <article className={cn("flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6", className)}>
      <div>
        <h3 className="text-heading-sm text-foreground">{title}</h3>
        <div className="mt-1.5 max-w-[60ch] text-body-sm text-muted-foreground">{children}</div>
      </div>
      <div className="mt-auto">{preview}</div>
    </article>
  );
}

function BriefingPreview() {
  return (
    <Panel className="overflow-hidden" aria-hidden="true">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <span className="text-body-sm font-semibold text-foreground">Needs attention</span>
        <span className="font-mono text-meta text-muted-foreground tabular-nums">Prepared 06:31</span>
      </div>
      <ul className="divide-y divide-border">
        <li className="space-y-1.5 px-3 py-3">
          <p className="flex items-center gap-2 text-body-sm font-medium text-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-priority-high" />
            Finish Q3 report
          </p>
          <p className="pl-3.5 text-body-sm text-muted-foreground">Due today · High</p>
          <div className="pl-3.5">
            <SourceChip icon={ListTodo}>Task</SourceChip>
          </div>
        </li>
        <li className="space-y-1.5 px-3 py-3">
          <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-foreground">
            <span className="size-1.5 shrink-0 rounded-full border border-border-strong" />
            Reply to Jordan Lee
            <Badge variant="inferred">Inferred</Badge>
          </p>
          <p className="pl-3.5 text-body-sm text-muted-foreground">Unread since Tue 17:42; asks for two call times this week.</p>
          <div className="pl-3.5">
            <SourceChip icon={Mail}>Gmail · “Next steps — Staff Engineer role”</SourceChip>
          </div>
        </li>
        <li className="space-y-1.5 px-3 py-3">
          <p className="flex items-center gap-2 text-body-sm font-medium text-foreground">
            <span className="size-1.5 shrink-0 rounded-full border border-border-strong" />
            Design review at 10:00
          </p>
          <p className="pl-3.5 text-body-sm text-muted-foreground">First meeting of the day; the agenda is in the invite.</p>
          <div className="pl-3.5">
            <SourceChip icon={CalendarDays}>Calendar · 10:00–10:45</SourceChip>
          </div>
        </li>
      </ul>
      <p className="border-t border-border px-3 py-2 font-mono text-meta text-muted-foreground">Tasks live · Calendar live · Gmail as of 06:30</p>
    </Panel>
  );
}

function CapturePreview() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Panel className="flex items-center gap-2 px-3 py-2.5 text-body text-foreground">
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">
          Book dentist <Token>next Tue</Token> <Token>#health</Token> <Token>!2</Token>
        </span>
      </Panel>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-body-sm text-muted-foreground">
        <Check className="size-3.5 text-success" />
        <span className="text-foreground">Added</span> · Tue 27 Oct · Health · High · <span className="font-medium text-brand">Undo</span>
      </p>
    </div>
  );
}

function MemoryPreview() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Panel className="px-3 py-2.5 text-body-sm text-foreground">Remember that the office wifi password is in the blue notebook</Panel>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-body-sm text-muted-foreground">
        <Bookmark className="size-3.5" />
        <span className="text-foreground">Saved to memory</span> · <span className="font-medium text-brand">Undo</span> · <span className="font-medium text-brand">View</span>
      </p>
    </div>
  );
}

function DraftPreview() {
  return (
    <Panel className="divide-y divide-border text-body-sm" aria-hidden="true">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-foreground">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Re: Next steps — Staff Engineer role</span>
        </span>
        <span className="shrink-0 rounded-sm border border-border px-1.5 text-meta text-muted-foreground">Draft · not sent</span>
      </div>
      <p className="px-3 py-2.5 text-muted-foreground">To Jordan Lee — “Thursday at 2pm works for me…”</p>
      <p className="flex items-center gap-1.5 px-3 py-2 text-muted-foreground">
        <Check className="size-3.5 text-success" />
        <span className="text-foreground">Draft saved in Gmail</span> · <span className="font-medium text-brand">Open in Gmail</span>
      </p>
    </Panel>
  );
}

const EVENTS = [
  { time: "09:30", title: "Stand-up" },
  { time: "10:00", title: "Design review" },
  { time: "14:00", title: "1:1 with Sam" },
];

function CalendarPreview() {
  return (
    <Panel className="text-body-sm" aria-hidden="true">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <span className="font-semibold text-foreground">Today&apos;s schedule</span>
        <span className="rounded-sm border border-border px-1.5 text-meta text-muted-foreground">Read-only</span>
      </div>
      <ul className="divide-y divide-border">
        {EVENTS.map((event) => (
          <li key={event.time} className="flex items-center gap-3 px-3 py-2">
            <span className="w-11 font-mono text-meta text-muted-foreground tabular-nums">{event.time}</span>
            <span className="text-foreground">{event.title}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-16 border-t border-border bg-surface-2/60">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <Reveal>
          <SectionHeading id="features-title" eyebrow="Features" title="One place to ask, one place to look">
            Your tasks live here. Gmail and Calendar are read where they are. Everything is reached from the same command bar.
          </SectionHeading>
        </Reveal>
        <Reveal className="mt-12 grid gap-4 lg:grid-cols-6">
          <Feature
            className="lg:col-span-4"
            title="The command bar"
            preview={<CommandDemo />}
          >
            <p>
              Press <Kbd>⌘K</Kbd> and say what you want in plain words, typed or spoken. Simple changes happen at once, each with Undo. Voice fills the bar and waits for you
              to press Enter.
            </p>
            <p className="sr-only">Example: “{SENTENCE}”. Result: Moved Q3 report to Thu 22 Oct, with Undo; Reminder set for 1:00 PM today: Reply to Jordan Lee, with Undo.</p>
          </Feature>
          <Feature className="lg:col-span-2 lg:row-span-2" title="Morning briefing" preview={<BriefingPreview />}>
            <p>
              At 06:30 it reads your tasks, Gmail and Calendar and lists at most seven things that need you. Every item shows its source, and anything it worked out rather than
              read is marked <span className="text-foreground">Inferred</span>.
            </p>
          </Feature>
          <Feature className="lg:col-span-2" title="Quick capture" preview={<CapturePreview />}>
            <p>
              Press <Kbd>C</Kbd> and type. Dates, #projects and !priorities are picked out by rules, with no AI call, so capture works even when the assistant is down.
            </p>
          </Feature>
          <Feature className="lg:col-span-2" title="Memory" preview={<MemoryPreview />}>
            <p>Tell it things worth keeping and ask for them later: “what did I note about the wifi?”</p>
          </Feature>
          <Feature className="lg:col-span-3" title="Gmail, drafts only" preview={<DraftPreview />}>
            <p>It searches your mail and writes replies as drafts. It never sends anything; you review and send from Gmail.</p>
          </Feature>
          <Feature className="lg:col-span-3" title="Calendar, read-only" preview={<CalendarPreview />}>
            <p>It reads Google Calendar to plan around your meetings. It never creates, moves or declines events.</p>
          </Feature>
        </Reveal>
      </div>
    </section>
  );
}
