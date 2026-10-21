"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface RandomLetterSwapProps {
  label: string;
  className?: string;
  staggerDuration?: number;
  transition?: {
    duration?: number;
    type?: string;
  };
}

export function RandomLetterSwap({
  label,
  className,
  staggerDuration = 0.025,
  transition = { duration: 0.6, type: "spring" },
}: RandomLetterSwapProps) {
  const [displayText, setDisplayText] = useState(label);
  const [isAnimating, setIsAnimating] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const animateLetters = () => {
    if (isAnimating) return;
    setIsAnimating(true);

    let iteration = 0;
    const maxIterations = label.length * 3;

    const interval = setInterval(() => {
      setDisplayText(
        label
          .split("")
          .map((letter, index) => {
            if (index < iteration / 3) {
              return label[index];
            }
            return letters[Math.floor(Math.random() * letters.length)];
          })
          .join("")
      );

      if (iteration >= maxIterations) {
        clearInterval(interval);
        setDisplayText(label);
        setIsAnimating(false);
      }

      iteration++;
    }, 30);

    return () => clearInterval(interval);
  };

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    animateLetters();
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <span
      className={cn(
        "inline-block transition-colors duration-200",
        className
      )}
      onMouseEnter={handleMouseEnter}
    >
      {displayText}
    </span>
  );
}
