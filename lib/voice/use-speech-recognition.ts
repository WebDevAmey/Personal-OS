'use client';
// lib/voice/use-speech-recognition.ts — push-to-toggle voice capture
// (ADR-015, FR-501..505, VOICE-001..006).
//
// Rules this hook enforces:
//  - Browser-native only; no audio leaves the browser through our servers.
//  - One utterance per start: no continuous or background listening; stops on
//    end-of-speech, stop(), cancel(), unmount, or after `maxMs` (30 s).
//  - It never submits anything. The final transcript is handed to `onFinal`,
//    which places it in the input for the user to edit and send.
//  - Every failure has a specific, typed error the UI can explain.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpeechRecognition, type SpeechRecognitionLike } from './types';

export type VoiceStatus = 'idle' | 'requesting' | 'listening';
export type VoiceError = 'denied' | 'no-speech' | 'network' | 'audio-capture' | 'unknown';

export interface UseSpeechRecognitionOptions {
  lang?: string;
  /** Hard stop (AC-503). */
  maxMs?: number;
  /** Receives the final transcript (trimmed, non-empty). Never auto-submit from here. */
  onFinal?: (text: string) => void;
}

export interface SpeechRecognitionState {
  /** null until checked after mount (keeps server and client markup identical). */
  supported: boolean | null;
  status: VoiceStatus;
  error: VoiceError | null;
  /** Live, not-yet-final words. */
  interim: string;
  /** Final words recognised so far in this utterance. */
  transcript: string;
  /** True once the microphone hears sound (drives the level indicator). */
  hearing: boolean;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  toggle: () => void;
  clearError: () => void;
}

const ERROR_MAP: Record<string, VoiceError> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'no-speech': 'no-speech',
  network: 'network',
  'audio-capture': 'audio-capture',
};

async function micPermissionDenied(): Promise<boolean> {
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return false;
    const status = await perms.query({ name: 'microphone' as PermissionName });
    return status.state === 'denied';
  } catch {
    // Firefox/Safari may not know the "microphone" permission name.
    return false;
  }
}

export function useSpeechRecognition({ lang, maxMs = 30_000, onFinal }: UseSpeechRecognitionOptions = {}): SpeechRecognitionState {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<VoiceError | null>(null);
  const [interim, setInterim] = useState('');
  const [transcript, setTranscript] = useState('');
  const [hearing, setHearing] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const cancelledRef = useRef(false);
  const errorRef = useRef<VoiceError | null>(null);
  const finalRef = useRef('');
  const interimRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const stop = useCallback(() => {
    clearTimer();
    recRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    cancelledRef.current = true;
    const rec = recRef.current;
    if (rec) rec.abort();
    else setStatus('idle');
    setInterim('');
    setTranscript('');
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    if (recRef.current) return;
    setError(null);
    errorRef.current = null;
    cancelledRef.current = false;
    finalRef.current = '';
    interimRef.current = '';
    setInterim('');
    setTranscript('');
    setHearing(false);
    setStatus('requesting');

    void micPermissionDenied().then((denied) => {
      if (cancelledRef.current) {
        setStatus('idle');
        return;
      }
      if (denied) {
        setError('denied');
        setStatus('idle');
        return;
      }
      const rec = new Ctor();
      rec.lang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      recRef.current = rec;

      const listening = () => setStatus('listening');
      rec.onstart = listening;
      rec.onaudiostart = listening;
      rec.onsoundstart = () => setHearing(true);
      rec.onspeechstart = () => setHearing(true);
      rec.onspeechend = () => setHearing(false);
      rec.onresult = (event) => {
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
          const r = event.results[i];
          const text = r[0]?.transcript ?? '';
          if (r.isFinal) finalText += text;
          else interimText += text;
        }
        finalRef.current = finalText.trim();
        interimRef.current = interimText.trim();
        setTranscript(finalRef.current);
        setInterim(interimRef.current);
      };
      rec.onerror = (event) => {
        if (event.error === 'aborted') return;
        const mapped = ERROR_MAP[event.error] ?? 'unknown';
        errorRef.current = mapped;
        setError(mapped);
      };
      rec.onend = () => {
        clearTimer();
        recRef.current = null;
        setStatus('idle');
        setHearing(false);
        setInterim('');
        if (cancelledRef.current) return;
        // A stop() mid-phrase leaves only interim words: keep them for editing.
        const text = (finalRef.current || interimRef.current).trim();
        if (text) {
          setTranscript(text);
          onFinalRef.current?.(text);
        } else if (!errorRef.current) {
          errorRef.current = 'no-speech';
          setError('no-speech');
        }
      };

      try {
        rec.start();
      } catch {
        recRef.current = null;
        setStatus('idle');
        setError('unknown');
        return;
      }
      timerRef.current = setTimeout(() => recRef.current?.stop(), maxMs);
    });
  }, [lang, maxMs]);

  const toggle = useCallback(() => {
    if (recRef.current) stop();
    else if (status !== 'idle') cancel();
    else start();
  }, [start, stop, cancel, status]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(
    () => () => {
      clearTimer();
      cancelledRef.current = true;
      recRef.current?.abort();
      recRef.current = null;
    },
    [],
  );

  return { supported, status, error, interim, transcript, hearing, start, stop, cancel, toggle, clearError };
}

/** User-facing copy for each failure (FR-505): what happened and the way forward. */
export const VOICE_ERROR_COPY: Record<VoiceError, string> = {
  denied:
    'Microphone access is blocked. Allow it in your browser’s site settings (the icon left of the address bar), then try again. You can keep typing.',
  'no-speech': 'Didn’t catch that. Try again, or type your command.',
  network: 'Voice recognition needs a network connection right now. Check your connection, or type instead.',
  'audio-capture': 'No microphone was found. Connect one, or type instead.',
  unknown: 'Voice input stopped unexpectedly. Try again, or type instead.',
};
