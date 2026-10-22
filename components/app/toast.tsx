'use client';
// components/app/toast.tsx — app toasts on Base UI Toast (docs/07 §9).
// Max 3 visible, Undo toasts last 10 s, timers pause on hover/focus (Base UI),
// F6 jumps into the toast region. A global manager lets non-React code
// (the command runner) raise toasts too.
import { Toast } from '@base-ui/react/toast';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '@/components/app/cn';

export const toastManager = Toast.createToastManager();

export type ToastTone = 'success' | 'error' | 'info';

export interface NotifyOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Shows an "Undo" (or custom label) action; the toast closes when it runs. */
  action?: { label: string; run: () => void | Promise<void> };
  timeout?: number;
}

export function notify({ title, description, tone = 'info', action, timeout }: NotifyOptions): string {
  const id = toastManager.add({
    title,
    description,
    type: tone,
    priority: tone === 'error' ? 'high' : 'low',
    timeout: timeout ?? (action ? 10_000 : 5_000),
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            toastManager.close(id);
            void action.run();
          },
        }
      : undefined,
  });
  return id;
}

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => {
    const tone = (t.type as ToastTone) ?? 'info';
    const Icon = ICONS[tone] ?? Info;
    return (
      <Toast.Root
        key={t.id}
        toast={t}
        className={cn(
          'pointer-events-auto relative w-full rounded-lg border border-border bg-popover text-popover-foreground shadow-overlay',
          'transition-[opacity,transform] duration-180 ease-out data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 data-limited:hidden',
        )}
      >
        <Toast.Content className="flex items-start gap-3 p-3">
          <Icon
            aria-hidden
            className={cn('mt-0.5 size-4 shrink-0', tone === 'success' && 'text-success', tone === 'error' && 'text-danger', tone === 'info' && 'text-subtle-foreground')}
          />
          <div className="min-w-0 flex-1">
            <Toast.Title className="text-body font-medium" />
            <Toast.Description className="text-body-sm text-muted-foreground" />
          </div>
          <Toast.Action className="h-7 shrink-0 rounded-md px-2 text-body-sm font-medium text-brand hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring" />
          <Toast.Close aria-label="Dismiss notification" className="grid size-7 shrink-0 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2 hover:text-foreground">
            <X aria-hidden className="size-4" />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager} limit={3}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed right-4 bottom-20 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col-reverse gap-2 md:bottom-4">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
