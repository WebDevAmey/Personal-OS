"use client";

import * as React from "react";
import { LazyMotion, MotionConfig, m, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/lib/ease";

/*
 * Motion on the landing page: one provider, features loaded lazily, and a
 * single reveal (8 px rise + fade, 240 ms, once) for sections below the fold.
 * Under reduced motion the reveal is an 80 ms fade with no movement.
 */

const features = () => import("./motion-features").then((mod) => mod.default);

export function MotionRoot({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={features} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}

export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const still = useReducedMotion();
  return (
    <m.div
      data-reveal=""
      className={className}
      initial={{ opacity: 0, y: still ? 0 : 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={still ? { duration: 0.08 } : { duration: 0.24, ease: EASE_OUT, delay }}
    >
      {children}
    </m.div>
  );
}
