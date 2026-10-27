import * as React from "react";
import { Bookmark, CalendarDays, Plus } from "lucide-react";
import { Tile } from "./bento-art";
import { Kbd } from "./mock";
import { Reveal } from "./motion";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 font-mono text-[0.6875rem] tracking-[0.06em] text-muted-foreground uppercase shadow-card">
      <span className="size-1.5 rounded-full bg-brand" />
      {children}
    </span>
  );
}

export function SplitHeading({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-end md:gap-12">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className="mt-5 font-serif text-[clamp(2.5rem,5.5vw,4.25rem)] leading-[1] tracking-[-0.02em] text-foreground">
          {title}
        </h2>
      </div>
      {children ? <p className="text-body-lg text-muted-foreground md:pb-2 md:text-right">{children}</p> : null}
    </div>
  );
}

const SMALL = [
  { icon: Plus, title: "Quick capture", body: <>Press <Kbd>C</Kbd> and type. Dates, #projects and !priorities are read by rules, so capture works even when the assistant is down.</> },
  { icon: Bookmark, title: "Memory", body: <>Tell it things worth keeping and ask later: “what did I note about the wifi?”</> },
  { icon: CalendarDays, title: "Calendar, read-only", body: <>It plans around your meetings and never creates, moves or declines an event.</> },
];

export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal>
          <SplitHeading
            id="features-title"
            eyebrow="Features"
            title={
              <>
                One bar to ask.
                <br />
                <em className="italic text-muted-foreground">One page to look.</em>
              </>
            }
          >
            Your tasks live here. Gmail and Calendar are read where they are. Everything is reached from the same command bar.
          </SplitHeading>
        </Reveal>

        <Reveal className="mt-14 grid gap-3 md:grid-cols-2 sm:gap-4">
          <Tile art="gauge" title="Ready before you are">
            At 06:30 it reads your tasks, mail and calendar and lists at most seven things that need you, each with its source.
          </Tile>
          <Tile art="command" title="Say it once">
            Press <Kbd>⌘K</Kbd> or hold the mic. Dates are resolved by rules against your time zone and hours, and the result names the exact day.
          </Tile>
          <Tile art="undo" title="Undo, always">
            Every change is recorded and can be reversed, whether you typed it, said it or tapped it.
          </Tile>
          <Tile art="draft" title="Drafts, never sends">
            It writes replies as Gmail drafts. Nothing leaves your outbox until you open Gmail and send it yourself.
          </Tile>
        </Reveal>

        <Reveal className="mt-10 grid gap-8 border-t border-border pt-10 sm:grid-cols-3 sm:gap-6">
          {SMALL.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="mt-3 text-heading-sm text-foreground">{title}</h3>
              <p className="mt-1 text-body text-muted-foreground">{body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
