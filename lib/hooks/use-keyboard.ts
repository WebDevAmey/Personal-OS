'use client';
// lib/hooks/use-keyboard.ts — keyboard helpers for the app shell (docs/07 §11.5).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** True when typing would go into a field, so single-key shortcuts must stay quiet (WCAG 2.1.4). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return Boolean(target.closest('[role="dialog"] [contenteditable], [role="textbox"]'));
}

/** Runs `handler` for every keydown on the document (capture phase), with a stable subscription. */
export function useDocumentKeydown(handler: (e: KeyboardEvent) => void, opts: { capture?: boolean } = {}) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const capture = opts.capture ?? false;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => ref.current(e);
    document.addEventListener('keydown', listener, { capture });
    return () => document.removeEventListener('keydown', listener, { capture });
  }, [capture]);
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** navigator.onLine; the server snapshot assumes online. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Mac-style modifier labels, decided after mount so server and client markup match. */
export function useIsMac(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
    setMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);
  return mac;
}

/** A localStorage-backed value (per-device conveniences only). */
export function useLocalSetting<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // storage unavailable: keep the default
    }
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // ignore
    }
  };
  return [value, set];
}
