import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Brand } from "@/components/landing/brand";

const COLUMNS = [
  {
    label: "Product",
    links: [
      { href: "#features", label: "Features" },
      { href: "#safety", label: "Safety" },
      { href: "#how-it-works", label: "How it works" },
      { href: "#faq", label: "FAQ" },
    ],
  },
  {
    label: "Account",
    links: [
      { href: "/sign-up", label: "Create an account" },
      { href: "/sign-in", label: "Sign in" },
      { href: "/forgot-password", label: "Reset password" },
    ],
  },
  {
    label: "Promises",
    links: [
      { href: "#promises", label: "Drafts only, never sends" },
      { href: "#promises", label: "Calendar is read-only" },
      { href: "#promises", label: "Undo on every change" },
    ],
  },
];

/* A loose cluster of squares fading out from one corner: the brand's list,
   broken into pixels. Deterministic so server and client agree. */
function Mosaic({ className, flip }: { className?: string; flip?: boolean }) {
  const cells: { x: number; y: number; o: number }[] = [];
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const d = Math.hypot(x, y) / 9;
      const noise = ((x * 7 + y * 13) % 5) / 10;
      const o = 1 - d - noise * 0.6;
      if (o > 0.12) cells.push({ x: flip ? 6 - x : x, y, o });
    }
  }
  return (
    <svg viewBox="0 0 70 70" className={className} aria-hidden="true">
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x * 10} y={c.y * 10} width="9" height="9" rx="1.5" fill="var(--mosaic)" opacity={c.o.toFixed(2)} />
      ))}
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="relative isolate overflow-hidden bg-[linear-gradient(180deg,var(--footer-top)_0%,var(--footer-bottom)_100%)] text-[var(--footer-ink)]">
      <Mosaic className="absolute top-[38%] -left-4 -z-10 w-36 sm:w-52" />
      <Mosaic className="absolute top-[30%] -right-4 -z-10 w-32 rotate-90 sm:w-48" flip />

      <div className="mx-auto max-w-6xl px-4 pt-24 sm:px-6 sm:pt-32">
        <div className="flex flex-col items-center text-center">
          <h2 className="font-serif text-[clamp(2.5rem,6vw,4.75rem)] leading-[1] tracking-[-0.02em]">
            Tomorrow at 06:30,
            <br />
            <em className="italic">it&apos;s ready.</em>
          </h2>
          <p className="mt-5 max-w-md text-body-lg text-[var(--footer-muted)]">Connect Google tonight. Your first briefing is waiting when you wake up.</p>
          <Link
            href="/sign-up"
            className="group mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--footer-ink)] pr-4 pl-5 text-body-lg font-medium text-[var(--footer-top)] transition-[scale,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
          >
            Get started
            <ArrowRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-24 grid gap-10 sm:mt-32 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div className="space-y-3">
            <Brand />
            <p className="max-w-[28ch] text-body-sm text-[var(--footer-muted)]">Tasks, Gmail and Calendar, managed by one command.</p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.label} aria-label={column.label}>
              <p className="font-mono text-[0.6875rem] tracking-[0.1em] text-[var(--footer-muted)] uppercase">{column.label}</p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="rounded-sm text-body-sm transition-colors duration-150 ease-out hover:text-[var(--footer-accent)]">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mt-16 text-meta text-[var(--footer-muted)]">© 2026 Personal OS. Figures built with the Anatomy kit (MIT).</p>
      </div>

      {/* giant wordmark, cropped by the page edge */}
      <div aria-hidden="true" className="mt-6 overflow-hidden">
        <p className="-mb-[0.24em] text-center text-[clamp(4.5rem,20.5vw,19rem)] leading-[0.85] font-semibold tracking-[-0.055em] whitespace-nowrap select-none">
          personal os
        </p>
      </div>
    </footer>
  );
}
