'use client';
// components/app/new-task-button.tsx — opens quick capture from inside a page
// (empty states, page headers). The shell owns the dialog.
import { Plus } from 'lucide-react';
import { cn } from './cn';

export const QUICK_CAPTURE_EVENT = 'pos:quick-capture';

export function NewTaskButton({ label = 'New task', variant = 'secondary', className }: { label?: string; variant?: 'primary' | 'secondary'; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(QUICK_CAPTURE_EVENT))}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-body font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        variant === 'primary' ? 'bg-brand text-brand-foreground hover:bg-brand/90' : 'border border-border bg-surface text-foreground hover:bg-surface-2',
        className,
      )}
    >
      <Plus aria-hidden className="size-4" />
      {label}
    </button>
  );
}
