// VOICE-008: the speech hook against a scripted SpeechRecognition.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechRecognition } from './use-speech-recognition';
import type { SpeechRecognitionEventLike, SpeechRecognitionLike } from './types';

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onnomatch: (() => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;
  aborted = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.stopped = true;
    this.onend?.();
  }
  abort() {
    this.aborted = true;
    this.onerror?.({ error: 'aborted' });
    this.onend?.();
  }
  emit(parts: { text: string; final: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: p.final }));
    this.onresult?.({ resultIndex: 0, results: Object.assign(results, { length: results.length }) } as unknown as SpeechRecognitionEventLike);
  }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

beforeEach(() => {
  FakeRecognition.instances = [];
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
});

afterEach(() => {
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useSpeechRecognition', () => {
  it('reports unsupported browsers', async () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(result.current.supported).toBe(false));
    act(() => result.current.start());
    expect(result.current.status).toBe('idle');
  });

  it('shows interim words live and hands over the final transcript without submitting', async () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onFinal, lang: 'en-GB' }));
    await waitFor(() => expect(result.current.supported).toBe(true));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    const rec = latest();
    expect(rec.lang).toBe('en-GB');
    expect(rec.continuous).toBe(false);
    expect(rec.interimResults).toBe(true);

    act(() => rec.emit([{ text: 'move the report', final: false }]));
    expect(result.current.interim).toBe('move the report');
    expect(onFinal).not.toHaveBeenCalled();

    act(() => rec.emit([{ text: 'move the report to tomorrow', final: true }]));
    act(() => rec.onend?.());
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('move the report to tomorrow');
    expect(result.current.status).toBe('idle');
    expect(result.current.interim).toBe('');
  });

  it('keeps interim words when the user stops mid-phrase', async () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onFinal }));
    await waitFor(() => expect(result.current.supported).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => latest().emit([{ text: 'remind me', final: false }]));
    act(() => result.current.toggle());
    expect(latest().stopped).toBe(true);
    expect(onFinal).toHaveBeenCalledWith('remind me');
  });

  it('cancel discards everything heard', async () => {
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onFinal }));
    await waitFor(() => expect(result.current.supported).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => latest().emit([{ text: 'delete everything', final: true }]));
    act(() => result.current.cancel());
    expect(latest().aborted).toBe(true);
    expect(onFinal).not.toHaveBeenCalled();
    expect(result.current.transcript).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('maps a denied microphone to the denied state', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(result.current.supported).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => {
      latest().onerror?.({ error: 'not-allowed' });
      latest().onend?.();
    });
    expect(result.current.error).toBe('denied');
    expect(result.current.status).toBe('idle');
  });

  it('does not start when the permission is already denied', async () => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: 'denied' })) },
    });
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(result.current.supported).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.error).toBe('denied'));
    expect(FakeRecognition.instances).toHaveLength(0);
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  });

  it('reports no-speech and network errors distinctly', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(result.current.supported).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => latest().onend?.());
    expect(result.current.error).toBe('no-speech');

    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => {
      latest().onerror?.({ error: 'network' });
      latest().onend?.();
    });
    expect(result.current.error).toBe('network');
  });

  it('stops by itself after the maximum listening time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onFinal, maxMs: 30_000 }));
    await waitFor(() => expect(result.current.supported).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => latest().emit([{ text: 'call the bank', final: true }]));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(latest().stopped).toBe(true);
    expect(result.current.status).toBe('idle');
    expect(onFinal).toHaveBeenCalledWith('call the bank');
  });

  it('aborts recognition on unmount', async () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(result.current.supported).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    unmount();
    expect(latest().aborted).toBe(true);
  });
});
