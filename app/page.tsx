import type { Metadata } from "next";
import "@/components/landing/figures/kit/iso.css";
import "@/components/landing/figures/iso-theme.css";
import "@/components/landing/landing.css";
import { Footer } from "@/components/footer/footer";
import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Nav } from "@/components/landing/nav";
import { Promises } from "@/components/landing/promises";
import { Safety } from "@/components/landing/safety";

export const metadata: Metadata = {
  title: "Personal OS — your day, managed by one command",
  description:
    "Personal OS keeps your tasks, reads Gmail and Google Calendar, prepares a short briefing at 06:30 and lets you change anything with one command, with Undo on every change.",
};

export default function Home() {
  return (
    <div className="landing">
      {/* Without JavaScript the reveals never run, so show their content. */}
      <noscript>
        <style>{"[data-reveal]{opacity:1!important;transform:none!important;translate:none!important}"}</style>
      </noscript>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-body focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-2 focus:outline-ring"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" className="bg-canvas">
        <Hero />
        <Features />
        <Safety />
        <HowItWorks />
        <Promises />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
