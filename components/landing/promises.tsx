import * as React from "react";
import { ArrowUpRight, CalendarX2, MailX, Undo2 } from "lucide-react";
import { cx as cn } from "@/components/ui/class-names";
import { SplitHeading } from "./features";
import { Reveal } from "./motion";

/*
 * Three promises as tall cards over generative line art: a row of vertical
 * strokes whose tops trace a smooth curve. Rendered on the server from a
 * deterministic function, so it costs no JavaScript.
 */

type Wave = { freq: number; phase: number; amp: number; base: number; tilt: number };

function LineArt({ id, wave, color }: { id: string; wave: Wave; color: string }) {
  const W = 300;
  const H = 400;
  const cols = 64;
  const step = W / cols;
  const lines = Array.from({ length: cols }, (_, i) => {
    const t = i / (cols - 1);
    const y = H * (wave.base + wave.amp * Math.sin(t * Math.PI * wave.freq + wave.phase) + wave.tilt * (t - 0.5));
    return { x: i * step + step / 2, y: Math.max(24, Math.min(H - 8, y)) };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
          <stop offset="0" stopColor={color} stopOpacity="0.55" />
          <stop offset="1" stopColor={color} stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {lines.map((l) => (
        <line key={l.x} x1={l.x} x2={l.x} y1={l.y} y2={H} stroke={`url(#${id})`} strokeWidth={step * 0.42} strokeLinecap="round" />
      ))}
    </svg>
  );
}

const CARDS = [
  {
    icon: MailX,
    title: "It never sends an email.",
    body: "Replies are saved as Gmail drafts. Pressing Send is yours.",
    link: { href: "#faq", label: "What Google access it asks for" },
    surface: "bg-[var(--promise-dark)]",
    line: "#ffffff",
    wave: { freq: 1.3, phase: 0.4, amp: 0.14, base: 0.42, tilt: 0.1 },
  },
  {
    icon: Undo2,
    title: "Every change can be undone.",
    body: "Typed, spoken or tapped, each change lands in Activity with one Undo.",
    link: { href: "#safety", label: "How confirmation works" },
    surface: "bg-[linear-gradient(160deg,var(--promise-blue-a),var(--promise-blue-b))]",
    line: "#c7d2fe",
    wave: { freq: 2.1, phase: 2.2, amp: 0.1, base: 0.38, tilt: -0.12 },
  },
  {
    icon: CalendarX2,
    title: "It never touches your calendar.",
    body: "Read-only. Ask it to block time and you get a task, not an event.",
    link: { href: "#faq", label: "What it reads" },
    surface: "bg-[var(--promise-dark)]",
    line: "#fdba74",
    wave: { freq: 0.9, phase: 4.1, amp: 0.18, base: 0.46, tilt: 0.05 },
  },
];

export function Promises() {
  return (
    <section id="promises" aria-labelledby="promises-title" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal>
          <SplitHeading
            id="promises-title"
            eyebrow="Promises"
            title={
              <>
                Three promises,
                <br />
                <em className="italic text-muted-foreground">kept in code.</em>
              </>
            }
          >
            These are not settings you can get wrong. The app has no way to send mail or edit events, and every write is logged.
          </SplitHeading>
        </Reveal>
        <Reveal className="mt-14 grid gap-3 sm:gap-4 md:grid-cols-3">
          {CARDS.map(({ icon: Icon, title, body, link, surface, line, wave }, i) => (
            <article key={title} className={cn("relative isolate flex min-h-[24rem] flex-col justify-between overflow-hidden rounded-3xl p-7 text-white md:aspect-[3/4] md:min-h-0 lg:p-8", surface)}>
              <div className="absolute inset-0 -z-10 opacity-80">
                <LineArt id={`promise-lines-${i}`} wave={wave} color={line} />
              </div>
              <span className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-serif text-[2rem] leading-[1.05] tracking-[-0.01em]">{title}</h3>
                <p className="mt-3 text-body text-white/75">{body}</p>
                <a href={link.href} className="group mt-5 inline-flex items-center gap-1 rounded-sm text-body-sm font-semibold text-white">
                  {link.label}
                  <ArrowUpRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
                </a>
              </div>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
