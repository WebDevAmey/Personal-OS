'use client';
// components/app/app-context.tsx — per-session facts the client needs
// everywhere: the user's local "today", projects for pickers, preferences
// that change behaviour (speech output, motion), and the task sheet opener.
import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ProjectDTO } from '@/components/tasks/types';
import type { MotionPreferenceName } from '@/components/settings/types';
import { useLocalSetting } from '@/lib/hooks/use-keyboard';

export interface AppSession {
  today: string;
  timeZone: string;
  locale: string;
  projects: ProjectDTO[];
  speechOutputEnabled: boolean;
  reducedMotion: MotionPreferenceName;
  email: string;
}

interface AppContextValue extends AppSession {
  shortcutsEnabled: boolean;
  setShortcutsEnabled: (v: boolean) => void;
  openTask: (id: string) => void;
  closeTask: () => void;
  /** The task row the user has focused/selected: the antecedent for "it" (docs/04 §8.2). */
  focusedTaskRef: React.RefObject<string | null>;
  projectName: (id: string | null) => string | null;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ session, children }: { session: AppSession; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [shortcutsEnabled, setShortcutsEnabled] = useLocalSetting('pos.shortcuts', true);
  const focusedTaskRef = useRef<string | null>(null);

  const openTask = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      next.set('task', id);
      router.push(`${pathname}?${next}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const closeTask = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('task');
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const value = useMemo<AppContextValue>(() => {
    const names = new Map(session.projects.map((p) => [p.id, p.name]));
    return {
      ...session,
      shortcutsEnabled,
      setShortcutsEnabled,
      openTask,
      closeTask,
      focusedTaskRef,
      projectName: (id) => (id ? (names.get(id) ?? null) : null),
    };
  }, [session, shortcutsEnabled, setShortcutsEnabled, openTask, closeTask]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

/** For components that also render outside the shell (tests, isolated pages). */
export function useOptionalApp(): AppContextValue | null {
  return useContext(Ctx);
}
