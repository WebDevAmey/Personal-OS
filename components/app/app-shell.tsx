'use client';
// components/app/app-shell.tsx — the signed-in frame (docs/07 §6): sidebar
// navigation with live counts, a top bar with the command trigger, quick add,
// voice and the account menu, plus the global overlays (palette, task sheet,
// quick capture, shortcut sheet) and global shortcuts.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import { domMax, LazyMotion, MotionConfig } from 'motion/react';
import { Keyboard, LogOut, Menu as MenuIcon, Mic, MonitorSmartphone, Plus, Search, Settings, WifiOff, X } from 'lucide-react';
import { AppProvider, useApp, type AppSession } from './app-context';
import { cn } from './cn';
import { Kbd } from './kbd';
import { ToastProvider, notify } from './toast';
import { ConfirmDialog } from './confirm-dialog';
import { QUICK_CAPTURE_EVENT } from './new-task-button';
import { PaletteProvider, usePalette } from '@/components/command/palette-provider';
import { CommandPalette, NAV_ITEMS, START_VOICE_EVENT } from '@/components/command/palette';
import { TaskSheet } from '@/components/tasks/task-sheet';
import { projectColor } from '@/components/tasks/format';
import { QuickCapture } from '@/components/tasks/quick-capture';
import { getSpeechRecognition } from '@/lib/voice/types';
import { isEditableTarget, useDocumentKeydown, useIsMac, useOnline } from '@/lib/hooks/use-keyboard';

export interface NavCounts {
  inbox: number;
  today: number;
  overdue: number;
}

export interface AppShellProps {
  session: AppSession;
  counts: NavCounts;
  displayName: string | null;
  children: React.ReactNode;
}

export function AppShell({ session, counts, displayName, children }: AppShellProps) {
  const reduced = session.reducedMotion === 'REDUCE' ? 'always' : session.reducedMotion === 'FULL' ? 'never' : 'user';
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', session.reducedMotion === 'REDUCE');
    return () => document.documentElement.classList.remove('reduce-motion');
  }, [session.reducedMotion]);
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion={reduced}>
        <AppProvider session={session}>
          <ToastProvider>
            <PaletteProvider>
              <Frame counts={counts} displayName={displayName}>
                {children}
              </Frame>
            </PaletteProvider>
          </ToastProvider>
        </AppProvider>
      </MotionConfig>
    </LazyMotion>
  );
}

const PRIMARY_NAV = NAV_ITEMS.filter((n) => ['/today', '/tasks/inbox', '/upcoming', '/tasks/overdue', '/tasks'].includes(n.href));
const SECONDARY_NAV = NAV_ITEMS.filter((n) => ['/tasks/completed', '/projects', '/memory'].includes(n.href));
const G_ROUTES: Record<string, string> = { t: '/today', i: '/tasks/inbox', u: '/upcoming', o: '/tasks/overdue', a: '/tasks', p: '/projects', m: '/memory', s: '/settings' };

function isActive(pathname: string, href: string): boolean {
  if (href === '/tasks') return pathname === '/tasks' || (pathname.startsWith('/tasks/') && !['/tasks/inbox', '/tasks/overdue', '/tasks/completed', '/tasks/upcoming'].some((p) => pathname.startsWith(p)));
  if (href === '/upcoming') return pathname.startsWith('/upcoming') || pathname.startsWith('/tasks/upcoming');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function countFor(href: string, counts: NavCounts): { n: number; tone?: 'danger' } | null {
  if (href === '/tasks/inbox') return counts.inbox ? { n: counts.inbox } : null;
  if (href === '/today') return counts.today ? { n: counts.today } : null;
  if (href === '/tasks/overdue') return counts.overdue ? { n: counts.overdue, tone: 'danger' } : null;
  return null;
}

function Frame({ counts, displayName, children }: { counts: NavCounts; displayName: string | null; children: React.ReactNode }) {
  const app = useApp();
  const palette = usePalette();
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnline();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const gPending = useRef<number | null>(null);

  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    const onCapture = () => setCaptureOpen(true);
    window.addEventListener(QUICK_CAPTURE_EVENT, onCapture);
    return () => window.removeEventListener(QUICK_CAPTURE_EVENT, onCapture);
  }, []);

  useDocumentKeydown((e) => {
    const mod = e.metaKey || e.ctrlKey;
    // ⌘K / Ctrl+K works everywhere, including inside fields (FR-401).
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.setOpen(!palette.open);
      return;
    }
    if (mod && e.shiftKey && (e.key === '.' || e.key === '>')) {
      if (palette.open) return; // the palette handles it
      e.preventDefault();
      window.dispatchEvent(new Event(START_VOICE_EVENT));
      return;
    }
    if (mod || e.altKey || isEditableTarget(e.target) || e.defaultPrevented) return;
    if (palette.open || captureOpen) return;
    if (document.querySelector('[role="dialog"],[role="alertdialog"]') && e.key !== '?') return;
    if (!app.shortcutsEnabled) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (gPending.current !== null) {
      window.clearTimeout(gPending.current);
      gPending.current = null;
      const href = G_ROUTES[key];
      if (href) {
        e.preventDefault();
        router.push(href);
      }
      return;
    }
    if (key === 'g') {
      gPending.current = window.setTimeout(() => (gPending.current = null), 1200);
      return;
    }
    if (key === 'c') {
      e.preventDefault();
      setCaptureOpen(true);
    } else if (key === '/') {
      e.preventDefault();
      palette.setOpen(true);
    } else if (e.key === '?') {
      e.preventDefault();
      setShortcutsOpen(true);
    }
  });

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-body focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-2 focus:outline-ring"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-[var(--sidebar-w)] shrink-0 flex-col border-r border-border bg-surface md:flex">
        <SidebarContent counts={counts} pathname={pathname} />
      </aside>

      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-180 data-ending-style:opacity-0 data-starting-style:opacity-0 md:hidden" />
          <Dialog.Popup className="fixed inset-y-0 left-0 z-40 flex w-[min(280px,85vw)] flex-col border-r border-border bg-surface shadow-overlay transition-transform duration-240 data-ending-style:-translate-x-full data-starting-style:-translate-x-full md:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Close className="absolute top-2.5 right-2 grid size-8 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2" aria-label="Close navigation">
              <X aria-hidden className="size-4" />
            </Dialog.Close>
            <SidebarContent counts={counts} pathname={pathname} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-4">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 md:hidden"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon aria-hidden className="size-5" />
          </button>
          <CommandTrigger />
          <div className="ml-auto flex items-center gap-1">
            {!online && (
              <span className="mr-1 inline-flex items-center gap-1.5 rounded-md bg-warning-subtle px-2 py-1 text-meta text-foreground" role="status">
                <WifiOff aria-hidden className="size-3.5" />
                <span className="hidden sm:inline">Offline</span>
              </span>
            )}
            <MicButton />
            <button
              type="button"
              onClick={() => setCaptureOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-2.5 text-body font-medium text-brand-foreground hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-keyshortcuts="C"
            >
              <Plus aria-hidden className="size-4" />
              <span className="hidden sm:inline">New task</span>
              <span className="sr-only sm:hidden">New task</span>
            </button>
            <AccountMenu email={app.email} displayName={displayName} onShortcuts={() => setShortcutsOpen(true)} />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>

      <CommandPalette />
      <TaskSheet />
      <QuickCapture open={captureOpen} onOpenChange={setCaptureOpen} />
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

function SidebarContent({ counts, pathname }: { counts: NavCounts; pathname: string }) {
  const app = useApp();
  const projects = app.projects.filter((p) => !p.archivedAt).slice(0, 8);
  return (
    <>
      <div className="flex h-[var(--topbar-h)] shrink-0 items-center gap-2 px-4">
        <Link href="/today" className="flex items-center gap-2 rounded-md text-heading-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-foreground text-[0.6875rem] font-semibold text-background">
            OS
          </span>
          Personal OS
        </Link>
      </div>
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3">
        <ul className="flex flex-col gap-px">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} count={countFor(item.href, counts)} />
          ))}
        </ul>
        <ul className="flex flex-col gap-px">
          {SECONDARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} count={null} />
          ))}
        </ul>
        {projects.length > 0 && (
          <div>
            <p id="nav-projects" className="px-2 pb-1 text-meta font-medium text-subtle-foreground">
              Projects
            </p>
            <ul aria-labelledby="nav-projects" className="flex flex-col gap-px">
              {projects.map((p) => {
                const href = `/projects/${p.id}`;
                const active = pathname === href;
                return (
                  <li key={p.id}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center gap-2 rounded-md px-2 text-body text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                        active && 'bg-surface-2 font-medium text-foreground',
                      )}
                    >
                      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: projectColor(p.color) }} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.openTaskCount > 0 && <span className="tabular text-meta text-subtle-foreground">{p.openTaskCount}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <ul className="mt-auto flex flex-col gap-px">
          <NavLink item={NAV_ITEMS.find((n) => n.href === '/settings')!} active={pathname.startsWith('/settings')} count={null} />
        </ul>
      </nav>
    </>
  );
}

function NavLink({ item, active, count }: { item: (typeof NAV_ITEMS)[number]; active: boolean; count: { n: number; tone?: 'danger' } | null }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-body text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          active && 'bg-surface-2 font-medium text-foreground',
        )}
      >
        <Icon aria-hidden className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-subtle-foreground')} />
        <span className="flex-1">{item.label}</span>
        {count && (
          <span className={cn('tabular text-meta', count.tone === 'danger' ? 'font-medium text-danger' : 'text-subtle-foreground')}>
            {count.n > 99 ? '99+' : count.n}
            <span className="sr-only"> {count.tone === 'danger' ? 'overdue' : 'tasks'}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

function CommandTrigger() {
  const palette = usePalette();
  const isMac = useIsMac();
  return (
    <button
      type="button"
      onClick={() => palette.setOpen(true)}
      aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      aria-haspopup="dialog"
      className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-left text-body text-subtle-foreground hover:border-border-strong hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring sm:max-w-[420px]"
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <span className="sm:hidden">Ask or command…</span>
        <span className="hidden sm:inline">Search, ask or tell Personal OS…</span>
      </span>
      <Kbd className="hidden sm:inline-flex">{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
    </button>
  );
}

function MicButton() {
  const [supported, setSupported] = useState(false);
  const isMac = useIsMac();
  useEffect(() => setSupported(Boolean(getSpeechRecognition())), []);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(START_VOICE_EVENT))}
      aria-label="Speak a command"
      title={`Speak a command (${isMac ? '⌘⇧.' : 'Ctrl+Shift+.'})`}
      aria-keyshortcuts={isMac ? 'Meta+Shift+.' : 'Control+Shift+.'}
      className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Mic aria-hidden className="size-4" />
    </button>
  );
}

const menuItem =
  'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-body text-foreground outline-none select-none data-highlighted:bg-surface-2 [&_svg]:size-4 [&_svg]:text-subtle-foreground';

function AccountMenu({ email, displayName, onShortcuts }: { email: string; displayName: string | null; onShortcuts: () => void }) {
  const router = useRouter();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const initial = (displayName ?? email).trim().charAt(0).toUpperCase() || '?';

  const signOut = async (everywhere: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(everywhere ? '/api/auth/sessions/revoke-all' : '/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      router.replace('/sign-in');
      router.refresh();
    } catch {
      notify({ title: "Couldn't sign out", description: 'Check your connection and try again.', tone: 'error' });
      setBusy(false);
    }
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Account menu"
          className="ml-1 grid size-8 place-items-center rounded-full bg-surface-2 text-body-sm font-medium text-foreground hover:ring-2 hover:ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {initial}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="z-50">
            <Menu.Popup className="min-w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-popover transition-[opacity,transform] duration-120 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0">
              <div className="px-2 py-1.5">
                {displayName && <p className="truncate text-body font-medium text-foreground">{displayName}</p>}
                <p className="truncate text-meta text-subtle-foreground">{email}</p>
              </div>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={menuItem} onClick={() => router.push('/settings')}>
                <Settings aria-hidden /> Settings
              </Menu.Item>
              <Menu.Item className={menuItem} onClick={onShortcuts}>
                <Keyboard aria-hidden /> Keyboard shortcuts
                <Kbd className="ml-auto">?</Kbd>
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={menuItem} disabled={busy} onClick={() => void signOut(false)}>
                <LogOut aria-hidden /> Sign out
              </Menu.Item>
              <Menu.Item className={menuItem} disabled={busy} onClick={() => setConfirmAll(true)}>
                <MonitorSmartphone aria-hidden /> Sign out everywhere
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out on every device?"
        description="Every browser signed in to Personal OS, including this one, will need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        busy={busy}
        onConfirm={() => void signOut(true)}
      />
    </>
  );
}

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Anywhere',
    items: [
      ['⌘K', 'Open the command palette'],
      ['⌘⇧.', 'Speak a command'],
      ['C', 'Quick add a task'],
      ['/', 'Search'],
      ['?', 'Show shortcuts'],
      ['G then T · I · U · O · A · P · S', 'Go to Today, Inbox, Upcoming, Overdue, All, Projects, Settings'],
    ],
  },
  {
    group: 'Task lists',
    items: [
      ['J / K', 'Move down / up'],
      ['E or Space', 'Complete or reopen'],
      ['Enter', 'Open details'],
      ['X', 'Select · Shift+J/K extends'],
      ['D · P · M', 'Set due date · priority · project'],
      ['Delete', 'Delete (asks first)'],
      ['⌘A · ⌘Z', 'Select all · Undo'],
    ],
  },
  {
    group: 'Command palette',
    items: [
      ['Enter', 'Run'],
      ['1 – 5', 'Pick a clarification option'],
      ['⌘↵', 'Confirm a proposal'],
      ['U', 'Undo the last result'],
      ['Esc', 'Stop listening, step back or close'],
    ],
  },
];

function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const app = useApp();
  const isMac = useIsMac();
  const fix = (k: string) => (isMac ? k : k.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace('↵', 'Enter'));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-180 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-overlay transition-[opacity,transform] duration-180 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close className="grid size-8 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2" aria-label="Close">
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </div>
          <label className="mt-3 flex items-center gap-2 text-body-sm text-muted-foreground">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={app.shortcutsEnabled} onChange={(e) => app.setShortcutsEnabled(e.target.checked)} />
            Single-key shortcuts (⌘K and arrow keys always work)
          </label>
          {SHORTCUTS.map((s) => (
            <section key={s.group} className="mt-4">
              <h3 className="mb-1.5 text-meta font-medium text-subtle-foreground">{s.group}</h3>
              <dl className="grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 gap-y-1.5">
                {s.items.map(([k, d]) => (
                  <div key={k} className="contents">
                    <dt className="text-body-sm">
                      <Kbd className="h-auto min-h-5 py-0.5 whitespace-normal">{fix(k)}</Kbd>
                    </dt>
                    <dd className="text-body-sm text-foreground">{d}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
