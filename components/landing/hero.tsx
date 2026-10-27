import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BriefingWindow } from "./briefing-window";

/*
 * Dawn hero: a warm field with slowly drifting light, a large serif
 * headline, and the product window rising into a curved band that hands off
 * to the page canvas. Colours come from the --dawn-* tokens in landing.css;
 * cream text on the darker half of the field keeps AA contrast.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* field */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,var(--dawn-1)_0%,var(--dawn-2)_38%,var(--dawn-3)_72%,var(--dawn-4)_100%)]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
        <div className="dawn-blob-a absolute top-[30%] left-[-10%] h-[60vh] w-[70vw] rounded-full bg-[radial-gradient(closest-side,var(--glow-a),transparent)] opacity-45 blur-3xl" />
        <div className="dawn-blob-b absolute top-[45%] right-[-15%] h-[55vh] w-[60vw] rounded-full bg-[radial-gradient(closest-side,var(--glow-c),transparent)] opacity-30 blur-3xl" />
        <div className="dawn-blob-a absolute top-[62%] left-[25%] h-[45vh] w-[50vw] rounded-full bg-[radial-gradient(closest-side,var(--glow-b),transparent)] opacity-40 blur-3xl [animation-delay:-9s]" />
        {/* fine grain so the gradient never bands */}
        <svg className="absolute inset-0 size-full opacity-[0.07] mix-blend-overlay">
          <filter id="hero-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#hero-grain)" />
        </svg>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pt-32 text-center sm:px-6 sm:pt-40">
        <p className="rise-in font-serif text-[1.375rem] text-[var(--dawn-ink-muted)] italic sm:text-2xl">Every morning at 06:30</p>
        <h1
          id="hero-title"
          className="rise-in mt-3 font-serif text-[clamp(3.25rem,10.5vw,9.5rem)] leading-[0.92] tracking-[-0.025em] text-[var(--dawn-ink)] [animation-delay:80ms]"
        >
          Your day,
          <br />
          <em className="italic">already sorted.</em>
        </h1>
        <p className="rise-in mt-6 max-w-xl text-body-lg text-[var(--dawn-ink-muted)] [animation-delay:160ms] sm:text-[1.0625rem] sm:leading-7">
          Personal OS reads your tasks, Gmail and Calendar before you wake, lists the few things that need you, and lets one typed or spoken command handle the rest.
        </p>
        <div className="rise-in mt-8 flex flex-wrap items-center justify-center gap-3 [animation-delay:240ms]">
          <Link
            href="/sign-up"
            className="group inline-flex h-11 items-center gap-2 rounded-full bg-[var(--dawn-ink)] pr-4 pl-5 text-body-lg font-medium text-[#1c0d07] transition-[scale,background-color] duration-150 ease-out hover:bg-white active:scale-[0.97]"
          >
            Get started
            <ArrowRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex h-11 items-center rounded-full px-5 text-body-lg font-medium text-[var(--dawn-ink)] ring-1 ring-[var(--dawn-ink)]/30 transition-[scale,background-color] duration-150 ease-out ring-inset hover:bg-white/10 active:scale-[0.97]"
          >
            Sign in
          </Link>
        </div>
      </div>

      <div className="relative mt-14 px-4 sm:mt-20 sm:px-6">
        {/* the band the window rises into */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[38%] bg-canvas [border-radius:50%_50%_0_0/100%_100%_0_0] sm:h-[45%]" />
        <div className="relative">
          <BriefingWindow />
        </div>
        <p className="relative mx-auto max-w-6xl py-8 text-center font-mono text-[0.6875rem] tracking-[0.06em] text-muted-foreground uppercase sm:py-10">
          Gmail and Google Calendar · Drafts only, never sends · Undo on every change
        </p>
      </div>
    </section>
  );
}
