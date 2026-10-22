'use client';
// components/command/palette-provider.tsx — owns the command lifecycle so it
// outlives the dialog: closing the palette while a command is pending does
// not cancel it, and its outcome arrives as a toast with the same Undo
// (FR-401, AC-408).
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { confirmProposal, newClientRequestId, sendCommand, type CommandResponse, type ExecutedAction } from './api';
import { commandRequestFor, initialPaletteState, paletteReducer, type LastRequest, type PaletteState } from './state';
import { spokenSummary } from './speech';
import { notify } from '@/components/app/toast';
import { tasksApi, ApiError } from '@/components/tasks/api';
import { useOptionalApp } from '@/components/app/app-context';
import { useSpeechOutput } from '@/lib/voice/speech-output';

const RECENT_KEY = 'pos.recentCommands';

export interface PaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the palette with text in the input (not submitted). */
  openWith: (text: string) => void;
  state: PaletteState;
  setInput: (value: string) => void;
  submit: (input: string, source: 'typed' | 'voice') => void;
  chooseOption: (optionId: string) => void;
  decide: (decision: 'confirm' | 'cancel') => void;
  retry: () => void;
  undo: (action: ExecutedAction) => void;
  reset: (keepInput?: boolean) => void;
  capture: (text: string, source: 'typed' | 'voice') => void;
  recent: string[];
  suggestions: string[];
  setSuggestions: (s: string[]) => void;
  speaking: boolean;
  stopSpeaking: () => void;
}

const Ctx = createContext<PaletteContextValue | null>(null);

function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

function pageOf(pathname: string): 'today' | 'tasks' | 'other' {
  if (pathname.startsWith('/today')) return 'today';
  if (pathname.startsWith('/tasks') || pathname.startsWith('/upcoming') || pathname.startsWith('/projects')) return 'tasks';
  return 'other';
}

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const app = useOptionalApp();
  const [open, setOpenState] = useState(false);
  const [state, dispatch] = useReducer(paletteReducer, initialPaletteState);
  const [recent, setRecent] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const speech = useSpeechOutput({ enabled: app?.speechOutputEnabled ?? false, lang: app?.locale });

  const openRef = useRef(open);
  const stateRef = useRef(state);
  useEffect(() => {
    openRef.current = open;
    stateRef.current = state;
  });
  useEffect(() => setRecent(readRecent()), []);

  const remember = (input: string) => {
    const next = [input, ...readRecent().filter((r) => r !== input)].slice(0, 5);
    setRecent(next);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const undoAction = useCallback(
    async (action: ExecutedAction) => {
      if (!action.undo) return;
      try {
        await tasksApi.undo({ eventId: action.undo.taskEventId });
        dispatch({ type: 'undone', proposalId: action.proposalId });
        notify({ title: 'Undone', description: action.summary, tone: 'success' });
        router.refresh();
      } catch (e) {
        notify({ title: "Couldn't undo", description: e instanceof ApiError ? e.message : undefined, tone: 'error' });
      }
    },
    [router],
  );

  const deliver = useCallback(
    (response: CommandResponse) => {
      dispatch({ type: 'result', response });
      const spoken = spokenSummary(response);
      if (spoken) speech.speak(spoken);
      if (response.kind === 'executed') router.refresh();
      if (!openRef.current) {
        // AC-408: the palette was closed while pending.
        if (response.kind === 'executed') {
          const undoable = response.actions.filter((a) => a.undo);
          notify({
            title: response.message,
            tone: 'success',
            action: undoable.length === 1 ? { label: 'Undo', run: () => undoAction(undoable[0]) } : undefined,
          });
        } else if (response.kind === 'error') {
          notify({ title: response.error.message, tone: 'error' });
        } else {
          notify({
            title: response.kind === 'clarification' ? response.question : response.message,
            description: response.kind === 'answer' ? undefined : 'Open the command bar (⌘K) to continue.',
            tone: 'info',
            action: { label: 'Open', run: () => setOpenState(true) },
          });
        }
      }
    },
    [router, speech, undoAction],
  );

  const run = useCallback(
    async (request: LastRequest, label: string) => {
      dispatch({ type: 'submit', request, label });
      const response = request.type === 'command' ? await sendCommand(request.req) : await confirmProposal(request.req);
      deliver(response);
    },
    [deliver],
  );

  const submit = useCallback(
    (input: string, source: 'typed' | 'voice') => {
      const text = input.trim();
      if (!text) return;
      const s = stateRef.current;
      const req = commandRequestFor(s, text, {
        clientRequestId: newClientRequestId(),
        source,
        focusedTaskId: app?.focusedTaskRef.current ?? undefined,
        page: pageOf(pathname),
      });
      if (!req.replyTo) remember(text);
      void run({ type: 'command', req }, 'Working…');
    },
    [app, pathname, run],
  );

  const chooseOption = useCallback(
    (optionId: string) => {
      const s = stateRef.current;
      if (s.response?.kind !== 'clarification') return;
      void run({ type: 'command', req: { clientRequestId: newClientRequestId(), replyTo: { runId: s.response.runId, optionId }, source: 'typed' } }, 'Working…');
    },
    [run],
  );

  const decide = useCallback(
    (decision: 'confirm' | 'cancel') => {
      const s = stateRef.current;
      if (s.response?.kind !== 'proposal') return;
      void run({ type: 'confirm', req: { proposalId: s.response.proposal.id, decision } }, decision === 'confirm' ? 'Applying…' : 'Cancelling…');
    },
    [run],
  );

  const retry = useCallback(() => {
    const last = stateRef.current.last;
    // Same clientRequestId / proposalId: the server returns the stored result
    // instead of applying the change twice (AC-405).
    if (last) void run(last, 'Retrying…');
  }, [run]);

  const capture = useCallback(
    async (text: string, source: 'typed' | 'voice') => {
      const line = text.replace(/^\s*\+\s*/, '').trim();
      if (!line) return;
      try {
        const r = await tasksApi.create({ capture: line, source: source === 'voice' ? 'VOICE' : 'MANUAL' });
        dispatch({ type: 'reset' });
        setOpenState(false);
        const where = r.task.status === 'INBOX' ? 'Added to Inbox' : 'Task added';
        notify({
          title: `${where}: ${r.task.title}`,
          description: r.unknownProject ? `No project called “${r.unknownProject}” — create it in Projects.` : r.similar.length ? `Similar task exists: ${r.similar[0].title}` : undefined,
          tone: 'success',
          action: r.undoEventId
            ? {
                label: 'Undo',
                run: async () => {
                  await tasksApi.undo({ eventId: r.undoEventId! });
                  router.refresh();
                },
              }
            : undefined,
        });
        router.refresh();
      } catch (e) {
        notify({ title: "Couldn't add the task", description: e instanceof ApiError ? e.message : undefined, tone: 'error' });
      }
    },
    [router],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next) {
        speech.stop();
        // A finished interaction starts fresh next time; a pending one keeps running.
        if (stateRef.current.status !== 'pending') dispatch({ type: 'reset' });
      }
    },
    [speech],
  );

  const value = useMemo<PaletteContextValue>(
    () => ({
      open,
      setOpen,
      openWith: (text: string) => {
        dispatch({ type: 'reset' });
        dispatch({ type: 'input', value: text });
        setOpenState(true);
      },
      state,
      setInput: (v: string) => dispatch({ type: 'input', value: v }),
      submit,
      chooseOption,
      decide,
      retry,
      undo: (a) => void undoAction(a),
      reset: (keepInput) => dispatch({ type: 'reset', keepInput }),
      capture: (t, s) => void capture(t, s),
      recent,
      suggestions,
      setSuggestions,
      speaking: speech.speaking,
      stopSpeaking: speech.stop,
    }),
    [open, setOpen, state, submit, chooseOption, decide, retry, undoAction, capture, recent, suggestions, speech.speaking, speech.stop],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePalette(): PaletteContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePalette must be used inside <PaletteProvider>');
  return v;
}

/** Lets a page offer its own suggestions (e.g. Today's briefing) while mounted. */
export function usePaletteSuggestions(list: string[]) {
  const v = useContext(Ctx);
  const key = list.join('\u0000');
  useEffect(() => {
    if (!v) return;
    v.setSuggestions(key ? key.split('\u0000') : []);
    return () => v.setSuggestions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
