import type { Metadata } from "next";
import Link from "next/link";
import "@/components/landing/figures/kit/iso.css";
import "@/components/landing/figures/iso-theme.css";
import { Footer } from "@/components/footer/footer";
import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { MotionRoot, Reveal } from "@/components/landing/motion";
import { Nav } from "@/components/landing/nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Personal OS — your day, managed by one command",
  description:
    "Personal OS keeps your tasks, reads Gmail and Google Calendar, prepares a short briefing at 06:30 and lets you change anything with one command, with Undo on every change.",
};

export default function Home() {
  return (
    <MotionRoot>
      {/* Without JavaScript the reveals never run, so show their content. */}
      <noscript>
        <style>{"[data-reveal]{opacity:1!important;transform:none!important}"}</style>
      </noscript>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-body focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-2 focus:outline-ring"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" className="bg-background">
        <Hero />
        <Features />
        <HowItWorks />
        <Faq />
        <section aria-labelledby="cta-title" className="border-t border-border">
          <Reveal className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="cta-title" className="text-display-sm text-foreground">
                Start with tomorrow morning
              </h2>
              <p className="mt-3 text-body-lg text-muted-foreground">Connect Google tonight and your first briefing is ready at 06:30.</p>
            </div>
            <Link href="/sign-up" className={cn(buttonVariants({ size: "lg" }), "h-10 px-4 text-body")}>
              Get started
            </Link>
          </Reveal>
        </section>
      </main>
      <Footer />
    </MotionRoot>
  );
}
