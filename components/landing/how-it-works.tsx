import * as React from "react";
import { cn } from "@/lib/utils";
import { GuardFigure } from "./figures/guard/figure";
import { StampFigure } from "./figures/stamp/figure";
import { Reveal } from "./motion";
import { SectionHeading } from "./section-heading";

function Row({ eyebrow, title, children, figure, flip }: { eyebrow: string; title: string; children: React.ReactNode; figure: React.ReactNode; flip?: boolean }) {
  return (
    <Reveal className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn("max-w-xl", flip && "lg:order-2")}>
        <p className="text-mono-label text-muted-foreground uppercase">{eyebrow}</p>
        <h3 className="mt-3 text-heading-lg text-foreground">{title}</h3>
        <div className="mt-4 space-y-4 text-body-lg text-muted-foreground">{children}</div>
      </div>
      <div className="iso min-w-0">{figure}</div>
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
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 border-t border-border">
      <div className="mx-auto max-w-6xl space-y-20 px-4 py-20 sm:px-6 sm:py-24 lg:space-y-28">
        <Reveal>
          <SectionHeading id="how-title" eyebrow="How it works" title="Exact about dates, careful with anything risky">
            A command is read by a model, but what it does is decided by rules you can predict.
          </SectionHeading>
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
        <Row eyebrow="Safety" title="Nothing risky happens without you" figure={<GuardFigure />} flip>
          <p>
            Single, reversible changes happen at once and can be undone. Anything bigger waits for you to confirm, with a list of exactly what will change.
          </p>
          <Facts
            items={[
              <>
                <span className="font-medium text-foreground">Bulk</span>: one command that changes more than one existing item.
              </>,
              <>
                <span className="font-medium text-foreground">Destructive</span>: deleting a task, project or memory.
              </>,
              <>
                <span className="font-medium text-foreground">External</span>: creating a Gmail draft, shown first as an editable preview.
              </>,
            ]}
          />
        </Row>
      </div>
    </section>
  );
}
