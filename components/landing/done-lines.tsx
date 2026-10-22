"use client";

import * as React from "react";
import { MotionConfig, motion } from "motion/react";
import { EASE_OUT } from "@/lib/ease";

/*
 * The Done lines arriving after the demo command finishes typing: a 6 px
 * slide-down and fade, 180 ms, the second 60 ms after the first (docs/07
 * §10.2, list insert). Loaded on demand, only when the demo has typed, so
 * Motion is never in the landing page's first chunk.
 */
export default function DoneLines({ children }: { children: React.ReactNode[] }) {
  return (
    <MotionConfig reducedMotion="user">
      {children.map((child, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: EASE_OUT, delay: index * 0.06 }}
        >
          {child}
        </motion.div>
      ))}
    </MotionConfig>
  );
}
