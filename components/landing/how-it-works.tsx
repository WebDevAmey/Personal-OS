import * as React from "react";
import { cx as cn } from "@/components/ui/class-names";
import { SorterFigure } from "./figures/sorter/figure";
import { StampFigure } from "./figures/stamp/figure";
import { SplitHeading } from "./features";
import { Reveal } from "./motion";

function Row({ eyebrow, title, children, figure, flip }: { eyebrow: string; title: string; children: React.ReactNode; figure: React.ReactNode; flip?: boolean }) {
  return (
    <Reveal className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn("max-w-xl", flip && "lg:order-2")}>
        <p className="font-mono text-[0.6875rem] tracking-[0.08em] text-muted-foreground uppercase">{eyebrow}</p>
        <h3 className="mt-3 font-serif text-[2.25rem] leading-[1.05] tracking-[-0.015em] text-foreground">{title}</h3>
        <div className="mt-4 space-y-4 text-body-lg text-muted-foreground">{children}</div>
      </div>
      <div className="iso min-w-0 rounded-3xl bg-surface p-3 shadow-card sm:p-4">{figure}</div>
    </Reveal>
  );
}

function Facts({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2 border-l border-border pl-4 text-body text-muted-foreground">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl space-y-20 px-4 py-20 sm:px-6 sm:py-28 lg:space-y-28">
        <Reveal>
          <SplitHeading
            id="how-title"
            eyebrow="How it works"
            title={
              <>
                Exact about dates.
                <br />
                <em className="italic text-muted-foreground">Strict about seven.</em>
              </>
            }
          >
            A command is read by a model, but what it does is decided by rules you can predict.
          </SplitHeading>
        </Reveal>
        <Row eyebrow="Dates" title="The same words give the same date" figure={<StampFigure />}>
          <p>
            Phrases like “tomorrow”, “next Tue” or “after lunch” are resolved by a date parser against your time zone and your working hours, not guessed. The result names the
            exact day it used.
          </p>
          <Facts
            items={[
              <>“tomorrow” on Wed 21 Oct is Thu 22 Oct, every time.</>,
              <>“after lunch” uses the lunch time you set; if you have not set one, it asks.</>,
            ]}
          />
        </Row>
        <Row eyebrow="Briefing" title="Everything read, seven things shown" figure={<SorterFigure />} flip>
          <p>
            The briefing reads every open task, recent mail and today&apos;s calendar, then keeps only what needs you. The rest is still there when you look; it just does not
            shout.
          </p>
          <Facts
            items={[
              <>Each item shows where it came from: a task, an email or an event.</>,
              <>
                Anything it worked out rather than read is marked <span className="font-medium text-foreground">Inferred</span>.
              </>,
            ]}
          />
        </Row>
      </div>
    </section>
  );
}
