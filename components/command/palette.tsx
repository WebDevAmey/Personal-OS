'use client';
// components/command/palette.tsx — the ⌘K / Ctrl+K command palette
// (docs/07 §11.1, docs/00 §5.4). States: suggestion (idle), pending,
// clarification, confirmation, done (with Undo), answer, error, offline.
// The input stays at the top; the body is a polite live region.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { Command as Cmdk } from 'cmdk';
import { AnimatePresence, m } from 'motion/react';
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CircleCheck,
  Command as CommandIcon,
  Folder,
  History,
  Inbox,
  List,
  BookMarked,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Volume2,
  WifiOff,
} from 'lucide-react';
import { Kbd } from '@/components/app/kbd';
import { useIsMac, useOnline } from '@/lib/hooks/use-keyboard';
import { useSpeechRecognition, VOICE_ERROR_COPY } from '@/lib/voice/use-speech-recognition';
import { usePalette } from './palette-provider';
import { ListeningMeter, VoiceButton } from './voice-button';
import { AnswerPanel, ClarificationPanel, ErrorPanel, ExecutedPanel, PendingPanel, ProposalPanel } from './panels';
import { SPRING_PANEL, SPRING_LAYOUT } from '@/lib/ease';

/** Dispatched on window to open the palette already listening. */
export const START_VOICE_EVENT = 'pos:start-voice';

export const NAV_ITEMS = [
  { label: 'Today', href: '/today', icon: Sun, keys: 'G T' },
  { label: 'Inbox', href: '/tasks/inbox', icon: Inbox, keys: 'G I' },
  { label: 'Upcoming', href: '/upcoming', icon: CalendarDays, keys: 'G U' },
  { label: 'Overdue', href: '/tasks/overdue', icon: CalendarClock, keys: 'G O' },
  { label: 'Completed', href: '/tasks/completed', icon: CircleCheck, keys: '' },
  { label: 'All tasks', href: '/tasks', icon: List, keys: 'G A' },
  { label: 'Projects', href: '/projects', icon: Folder, keys: 'G P' },
  { label: 'Memory', href: '/memory', icon: BookMarked, keys: '' },
  { label: 'Settings', href: '/settings', icon: Settings, keys: 'G S' },
] as const;

const itemClass =
  'relative flex h-9 cursor-default items-center gap-3 rounded-md px-3 text-body text-foreground select-none data-[selected=true]:bg-surface-2 data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-1.5 data-[selected=true]:before:left-0 data-[selected=true]:before:w-0.5 data-[selected=true]:before:rounded-full data-[selected=true]:before:bg-brand [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-subtle-foreground';
const groupClass =
  'px-1 pb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:text-subtle-foreground';

export function CommandPalette() {
  const p = usePalette();
  const router = useRouter();
  const online = useOnline();
  const isMac = useIsMac();
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<'typed' | 'voice'>('typed');
  const [fromVoice, setFromVoice] = useState(false);
  const { state } = p;
  const capturing = state.input.trimStart().startsWith('+');

  const voice = useSpeechRecognition({
    onFinal: (text) => {
      // ADR-015: the transcript goes into the input, selected, and waits for Enter.
      sourceRef.current = 'voice';
      setFromVoice(true);
      p.setInput(text);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    },
  });

  // The shell's mic button and ⌘⇧. open the palette and ask it to listen.
  useEffect(() => {
    const onStart = () => {
      p.setOpen(true);
      if (voice.status === 'idle') voice.start();
    };
    window.addEventListener(START_VOICE_EVENT, onStart);
    return () => window.removeEventListener(START_VOICE_EVENT, onStart);
  }, [p, voice]);

  // Closing the palette stops listening (FR-502).
  useEffect(() => {
    if (!p.open) voice.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open]);

  const mod = isMac ? '⌘' : 'Ctrl';
  const voiceShortcut = isMac ? '⌘⇧.' : 'Ctrl+Shift+.';
  const confirmShortcut = isMac ? '⌘↵' : 'Ctrl+↵';

  const submitInput = () => {
    const text = state.input.trim();
    if (!text) return;
    if (text.startsWith('+')) {
      p.capture(text, sourceRef.current);
    } else if (online) {
      p.submit(text, sourceRef.current);
    }
    sourceRef.current = 'typed';
    setFromVoice(false);
  };

  const go = (href: string) => {
    p.setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const modKey = e.metaKey || e.ctrlKey;
    if (modKey && e.shiftKey && (e.key === '.' || e.key === '>')) {
      e.preventDefault();
      voice.toggle();
      return;
    }
    if (e.key === 'Escape') {
      if (voice.status !== 'idle') {
        e.preventDefault();
        e.stopPropagation();
        voice.cancel();
        return;
      }
      if (state.status === 'clarification' || state.status === 'error' || state.status === 'answer') {
        e.preventDefault();
        e.stopPropagation();
        p.reset(true);
        return;
      }
      if (state.status === 'proposal') {
        e.preventDefault();
        e.stopPropagation();
        p.decide('cancel');
        return;
      }
      return; // let the dialog close
    }
    if (state.status === 'proposal' && modKey && e.key === 'Enter') {
      e.preventDefault();
      p.decide('confirm');
      return;
    }
    if (state.status === 'executed' && ((modKey && e.key.toLowerCase() === 'z') || (!state.input && e.key.toLowerCase() === 'u'))) {
      if (state.response?.kind !== 'executed') return;
      const last = [...state.response.actions].reverse().find((a) => a.undo && !state.undone.includes(a.proposalId));
      if (last) {
        e.preventDefault();
        p.undo(last);
      }
      return;
    }
    if (state.status === 'clarification' && !state.input && /^[1-5]$/.test(e.key) && state.response?.kind === 'clarification') {
      const opt = state.response.options[Number(e.key) - 1];
      if (opt) {
        e.preventDefault();
        p.chooseOption(opt.id);
      }
      return;
    }
    if (e.key === 'Enter' && state.status !== 'idle' && state.status !== 'pending') {
      e.preventDefault();
      if (state.status === 'error' && !state.input.trim()) p.retry();
      else if (state.input.trim()) submitInput();
    }
  };

  const status = state.status;
  const pending = status === 'pending';
  const query = state.input.trim();
  const lower = query.toLowerCase();
  const navMatches = NAV_ITEMS.filter((n) => !lower || n.label.toLowerCase().includes(lower) || `go to ${n.label}`.toLowerCase().includes(lower));
  const recents = p.recent.filter((r) => !lower || r.toLowerCase().includes(lower));
  const suggestions = p.suggestions.filter((s) => !lower || s.toLowerCase().includes(lower)).slice(0, 4);

  return (
    <Dialog.Root open={p.open} onOpenChange={(open) => p.setOpen(open)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-180 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        <Dialog.Popup
          initialFocus={inputRef}
          aria-describedby="pal-hint"
          className="fixed top-2 left-1/2 z-50 w-[calc(100vw-16px)] -translate-x-1/2 outline-none sm:top-[20vh] sm:w-[var(--palette-w)]"
        >
          <m.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={SPRING_PANEL}
            className="overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-overlay"
          >
            <Dialog.Title className="sr-only">Command bar</Dialog.Title>
            <Cmdk label="Command bar" shouldFilter={false} loop onKeyDown={onKeyDown} className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-border px-3">
                {capturing ? <Plus aria-hidden className="size-4 text-brand" /> : <CommandIcon aria-hidden className="size-4 text-subtle-foreground" />}
                <Cmdk.Input
                  ref={inputRef}
                  value={state.input}
                  onValueChange={(v) => {
                    if (!v) {
                      sourceRef.current = 'typed';
                      setFromVoice(false);
                    }
                    p.setInput(v);
                  }}
                  readOnly={pending}
                  aria-busy={pending}
                  maxLength={2000}
                  placeholder={
                    voice.status === 'listening'
                      ? 'Listening…'
                      : status === 'clarification'
                        ? 'Type an answer, or pick an option'
                        : 'Type a command, or + to capture'
                  }
                  className="h-12 min-w-0 flex-1 bg-transparent text-body-lg text-foreground outline-none placeholder:text-subtle-foreground read-only:text-muted-foreground"
                />
                {p.speaking && (
                  <button type="button" onClick={p.stopSpeaking} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-body-sm text-foreground hover:bg-surface-2">
                    <Volume2 aria-hidden className="size-3.5" /> Stop speaking
                  </button>
                )}
                <VoiceButton voice={voice} shortcut={voiceShortcut} />
                <Kbd className="hidden sm:inline-flex">Esc</Kbd>
              </div>
              {pending && (
                <div className="h-0.5 w-full overflow-hidden bg-surface-2" aria-hidden>
                  <div className="h-full w-2/5 animate-[pos-pending_1.2s_linear_infinite] bg-brand motion-reduce:animate-none" />
                  <style>{`@keyframes pos-pending{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}`}</style>
                </div>
              )}

              {(voice.status !== 'idle' || voice.interim) && (
                <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-body-sm text-muted-foreground">
                  <ListeningMeter active={voice.hearing} />
                  <span>{voice.status === 'requesting' ? 'Allow microphone access to use voice' : 'Listening…'}</span>
                  {voice.interim && <span className="truncate italic">“{voice.interim}”</span>}
                  <button type="button" onClick={voice.cancel} className="ml-auto rounded-md px-2 py-0.5 text-foreground hover:bg-surface-2">
                    Cancel
                  </button>
                </div>
              )}
              {voice.error && voice.status === 'idle' && (
                <div className="flex items-start gap-2 border-b border-border px-4 py-2 text-body-sm text-foreground" role="alert">
                  <span className="flex-1">{VOICE_ERROR_COPY[voice.error]}</span>
                  {voice.error === 'no-speech' || voice.error === 'network' ? (
                    <button type="button" onClick={voice.start} className="rounded-md px-2 py-0.5 hover:bg-surface-2">
                      Retry
                    </button>
                  ) : null}
                  <button type="button" onClick={voice.clearError} className="rounded-md px-2 py-0.5 text-muted-foreground hover:bg-surface-2">
                    Dismiss
                  </button>
                </div>
              )}
              {!online && (
                <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-body-sm text-muted-foreground">
                  <WifiOff aria-hidden className="size-4" />
                  You&apos;re offline. Commands need a connection; quick capture with + will be tried when you press Enter.
                </div>
              )}

              <m.div layout transition={SPRING_LAYOUT} className="max-h-[min(60vh,480px)] overflow-y-auto">
                <div aria-live="polite" aria-atomic="false">
                  {/* The input's aria-controls must always resolve to a listbox while a panel shows.
                      Kept outside AnimatePresence so it unmounts at once and never coexists with the real list. */}
                  {status !== 'idle' && <Cmdk.List hidden />}
                  <AnimatePresence mode="popLayout" initial={false}>
                    <m.div key={status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                      {status === 'idle' && (
                        <Cmdk.List className="py-1">
                          {query && (
                            <Cmdk.Group className={groupClass}>
                              <Cmdk.Item value="__run__" onSelect={submitInput} className={itemClass} disabled={!capturing && !online}>
                                {capturing ? <Plus aria-hidden /> : <ArrowRight aria-hidden />}
                                <span className="min-w-0 flex-1 truncate">
                                  {capturing ? 'Add task: ' : 'Run: '}
                                  <span className="font-medium">{capturing ? query.replace(/^\+\s*/, '') : query}</span>
                                </span>
                                <Kbd>↵</Kbd>
                              </Cmdk.Item>
                            </Cmdk.Group>
                          )}
                          {!capturing && suggestions.length > 0 && (
                            <Cmdk.Group heading="Suggested from your briefing" className={groupClass}>
                              {suggestions.map((s) => (
                                <Cmdk.Item key={s} value={`sug:${s}`} onSelect={() => p.setInput(s)} className={itemClass}>
                                  <Sparkles aria-hidden />
                                  <span className="truncate">{s}</span>
                                </Cmdk.Item>
                              ))}
                            </Cmdk.Group>
                          )}
                          {!capturing && recents.length > 0 && (
                            <Cmdk.Group heading="Recent" className={groupClass}>
                              {recents.map((r) => (
                                <Cmdk.Item key={r} value={`rec:${r}`} onSelect={() => p.setInput(r)} className={itemClass}>
                                  <History aria-hidden />
                                  <span className="truncate">{r}</span>
                                </Cmdk.Item>
                              ))}
                            </Cmdk.Group>
                          )}
                          {!capturing && navMatches.length > 0 && (
                            <Cmdk.Group heading="Go to" className={groupClass}>
                              {navMatches.map((n) => (
                                <Cmdk.Item key={n.href} value={`nav:${n.href}`} onSelect={() => go(n.href)} className={itemClass}>
                                  <n.icon aria-hidden />
                                  <span className="flex-1">{n.label}</span>
                                  {n.keys && <span className="font-mono text-meta text-subtle-foreground">{n.keys}</span>}
                                </Cmdk.Item>
                              ))}
                            </Cmdk.Group>
                          )}
                          {!query && (
                            <Cmdk.Group className={groupClass}>
                              <Cmdk.Item value="__capture__" onSelect={() => p.setInput('+ ')} className={itemClass}>
                                <Plus aria-hidden />
                                <span className="flex-1">Capture a task</span>
                                <Kbd>C</Kbd>
                              </Cmdk.Item>
                            </Cmdk.Group>
                          )}
                        </Cmdk.List>
                      )}
                      {status === 'pending' && <PendingPanel label={state.pendingLabel ?? 'Working…'} />}
                      {status === 'clarification' && state.response?.kind === 'clarification' && (
                        <ClarificationPanel response={state.response} onChoose={p.chooseOption} onRephrase={() => p.reset(true)} />
                      )}
                      {status === 'proposal' && state.response?.kind === 'proposal' && (
                        <ProposalPanel response={state.response} onDecide={p.decide} confirmShortcut={confirmShortcut} />
                      )}
                      {status === 'executed' && state.response?.kind === 'executed' && (
                        <ExecutedPanel response={state.response} undone={state.undone} onUndo={p.undo} />
                      )}
                      {status === 'answer' && state.response?.kind === 'answer' && <AnswerPanel response={state.response} />}
                      {status === 'error' && state.response?.kind === 'error' && (
                        <ErrorPanel response={state.response} onRetry={p.retry} onCapture={() => p.setInput('+ ')} />
                      )}
                    </m.div>
                  </AnimatePresence>
                </div>
              </m.div>

              <div id="pal-hint" className="flex items-center gap-3 border-t border-border px-3 py-2 text-meta text-subtle-foreground">
                {fromVoice && state.input ? (
                  <span className="text-foreground">Press Enter to run, or edit first.</span>
                ) : voice.supported === false ? (
                  <span>Voice isn&apos;t supported in this browser — type instead.</span>
                ) : (
                  <span>
                    <Kbd>↵</Kbd> run · <Kbd>{voiceShortcut}</Kbd> voice
                  </span>
                )}
                <span className="ml-auto hidden sm:inline">
                  Nothing risky runs without your confirmation · <Kbd>{mod} K</Kbd>
                </span>
              </div>
            </Cmdk>
          </m.div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
