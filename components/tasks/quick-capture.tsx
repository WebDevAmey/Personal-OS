'use client';
// components/tasks/quick-capture.tsx — the C shortcut (FR-201): one line,
// parsed locally into chips so the user sees what will be set before Enter.
// The server parses the same line again; the chips are a preview only.
import { useMemo, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { CalendarDays, Flag, Folder, Hash, Plus } from 'lucide-react';
import { useApp } from '@/components/app/app-context';
import { Kbd } from '@/components/app/kbd';
import { usePalette } from '@/components/command/palette-provider';
import { parseCapture, type CaptureToken } from './capture';

const CHIP_ICON: Record<CaptureToken['kind'], React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  date: CalendarDays,
  project: Folder,
  priority: Flag,
  tag: Hash,
};

export function QuickCapture({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const app = useApp();
  const palette = usePalette();
  const [value, setValue] = useState('');
  const parsed = useMemo(() => parseCapture(value, app.today), [value, app.today]);
  const unknownProject = parsed.projectName && !app.projects.some((p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase());

  const submit = () => {
    if (!value.trim()) return;
    palette.capture(value, 'typed');
    setValue('');
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-180 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        <Dialog.Popup className="fixed top-[12vh] left-1/2 z-50 w-[var(--palette-w)] -translate-x-1/2 rounded-xl border border-border bg-popover text-popover-foreground shadow-overlay transition-[opacity,transform] duration-180 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0">
          <Dialog.Title className="sr-only">Quick add task</Dialog.Title>
          <Dialog.Description className="sr-only">
            Type a task. Use a date like tomorrow 3pm, #project, @tag and !1 for urgent. Press Enter to add.
          </Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex items-center gap-3 px-4">
              <Plus aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
              <input
                autoFocus
                aria-label="New task"
                value={value}
                maxLength={600}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Call the bank tomorrow 3pm #Finance !2"
                className="h-12 min-w-0 flex-1 bg-transparent text-body-lg text-foreground placeholder:text-subtle-foreground focus:outline-none"
              />
            </div>
            <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-t border-border px-4 py-2" aria-live="polite">
              {parsed.tokens.length === 0 ? (
                <span className="text-meta text-subtle-foreground">Dates, #project, @tag and !1–!4 are picked up as you type.</span>
              ) : (
                parsed.tokens.map((t, i) => {
                  const Icon = CHIP_ICON[t.kind];
                  return (
                    <span key={i} className="inline-flex h-6 items-center gap-1 rounded-sm bg-surface-2 px-1.5 text-meta text-foreground">
                      <Icon aria-hidden className="size-3.5 text-subtle-foreground" />
                      {t.label}
                    </span>
                  );
                })
              )}
              {unknownProject && <span className="text-meta text-warning">No project named “{parsed.projectName}” — it will go to Inbox.</span>}
              <span className="ml-auto flex items-center gap-1 text-meta text-subtle-foreground">
                <Kbd>↵</Kbd> add · <Kbd>Esc</Kbd> close
              </span>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
