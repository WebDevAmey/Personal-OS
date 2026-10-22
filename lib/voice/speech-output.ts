'use client';
// lib/voice/speech-output.ts — optional spoken results (FR-506, VOICE-005).
// Off by default (UserPreference.speechOutputEnabled). Only short system
// messages are ever spoken: never email bodies, snippets or subjects, and
// never anything derived from untrusted content (see spokenSummary in
// components/command/speech.ts).
import { useCallback, useEffect, useState } from 'react';

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

export interface SpeechOutput {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  stop: () => void;
}

export function useSpeechOutput({ enabled, lang }: { enabled: boolean; lang?: string }): SpeechOutput {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => setSupported(speechSynthesisSupported()), []);

  const stop = useCallback(() => {
    if (!speechSynthesisSupported()) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!enabled || !speechSynthesisSupported()) return;
      const clean = text.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const u = new window.SpeechSynthesisUtterance(clean);
      if (lang) u.lang = lang;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [enabled, lang],
  );

  // Turning the preference off, or leaving, silences anything in progress.
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);
  useEffect(() => () => stop(), [stop]);

  return { supported, speaking, speak, stop };
}
