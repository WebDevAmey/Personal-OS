import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cx as cn } from "@/components/ui/class-names";
import { SorterFigure } from "./figures/sorter/figure";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14 lg:pt-24 lg:pb-24">
      <div className="max-w-xl">
        <p className="text-mono-label text-muted-foreground uppercase">Tasks · Gmail · Calendar</p>
        <h1 id="hero-title" className="mt-4 text-display text-foreground text-balance">
          Your day, managed by one command
        </h1>
        <p className="mt-5 text-body-lg text-muted-foreground sm:text-[1.0625rem] sm:leading-7">
          Personal OS reads your tasks, Gmail and Google Calendar. Every morning at 06:30 it lists the few things that need you, and one typed or spoken
          command handles the rest, with Undo on every change.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/sign-up" className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}>
            Get started
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
          <Link href="/sign-in" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 px-4")}>
            Sign in
          </Link>
        </div>
        <p className="mt-6 text-body-sm text-muted-foreground">Sign in with email, Google, GitHub or a passkey.</p>
      </div>
      <div className="iso min-w-0">
        <SorterFigure />
      </div>
    </section>
  );
}
