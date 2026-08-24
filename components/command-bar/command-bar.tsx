'use client';

import { useState, useRef, useEffect } from 'react';
import { Command, CommandInput } from '@/components/ui/command';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AnimatedTooltip } from '@/components/ui/animated-tooltip';

// The Web Speech API's `SpeechRecognition`/`webkitSpeechRecognition` aren't
// part of TypeScript's DOM lib, so we declare the minimal shape we use here
// rather than reaching for `any`.
interface SpeechRecognitionResultEvent {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}
interface SpeechRecognitionLike {
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  start: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface WindowWithSpeechRecognition {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

// `AnimatedTooltip` (VengeanceUI) isn't a plain "show this string" component —
// it's a hover/focus-driven tooltip: `children` is the always-visible trigger,
// `content` is the bubble revealed (with its built-in entrance animation) once
// `open` flips true internally via onMouseEnter/onFocus. There's no `text` prop
// and no externally-controlled `open` prop. To surface the confirmation message
// automatically (not only on hover) we render the message as both the trigger
// and the bubble content, then programmatically focus the trigger on mount so
// the component's own entrance animation plays without requiring user hover.
function ConfirmationTooltip({ message }: { message: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = containerRef.current?.querySelector<HTMLElement>('[role="button"]');
    trigger?.focus();
  }, [message]);

  return (
    <div ref={containerRef}>
      <AnimatedTooltip content={message}>{message}</AnimatedTooltip>
    </div>
  );
}

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  async function submit(value: string) {
    setPending(true);
    setMessage(null);
    const res = await fetch('/api/command', { method: 'POST', body: JSON.stringify({ input: value }) });
    const json = await res.json();
    setMessage(json.message ?? json.error);
    setPending(false);
    setInput('');
  }

  function startVoice() {
    const { SpeechRecognition, webkitSpeechRecognition } = window as unknown as WindowWithSpeechRecognition;
    const SpeechRecognitionCtor = SpeechRecognition ?? webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setMessage('Voice input is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      submit(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <Command>
          <CommandInput
            placeholder="Speak or type..."
            value={input}
            onValueChange={setInput}
            onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) submit(input); }}
          />
        </Command>
        <button onClick={startVoice} aria-label="Start voice input">🎙️</button>
        {pending && <p>Thinking…</p>}
        {message && (
          <div role="status">
            <ConfirmationTooltip message={message} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
