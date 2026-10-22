'use client';
// components/command/voice-button.tsx — mic toggle (docs/07 §11.2).
// Not rendered at all when the browser has no SpeechRecognition (AC-501);
// the palette shows a "type instead" hint in that case.
import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/components/app/cn';
import type { SpeechRecognitionState } from '@/lib/voice/use-speech-recognition';

export function VoiceButton({ voice, shortcut }: { voice: SpeechRecognitionState; shortcut: string }) {
  if (!voice.supported) return null;
  const listening = voice.status === 'listening';
  const requesting = voice.status === 'requesting';
  const denied = voice.error === 'denied';
  const label = listening ? 'Stop voice input' : `Start voice input (${shortcut})`;
  return (
    <button
      type="button"
      onClick={voice.toggle}
      aria-pressed={listening || requesting}
      aria-label={label}
      title={label}
      className={cn(
        'relative grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-80',
        listening ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        denied && !listening && 'text-danger',
      )}
    >
      {denied && !listening ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
    </button>
  );
}

/** Three-bar level indicator; static under reduced motion (CSS guard). */
export function ListeningMeter({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="flex h-3 items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn('w-0.5 origin-bottom rounded-sm bg-brand',active ? 'animate-[pos-level_0.9s_ease-in-out_infinite]' : 'h-1')}
          style={active ? { animationDelay: `${i * 0.15}s`, height: '0.75rem' } : undefined}
        />
      ))}
      <style>{`@keyframes pos-level{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}`}</style>
    </span>
  );
}
