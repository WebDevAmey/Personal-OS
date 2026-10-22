'use client';
// components/app/confirm-dialog.tsx — destructive / bulk confirmation on
// Base UI AlertDialog (FR-261): focus is trapped, Esc cancels, focus returns.
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { cn } from '@/components/app/cn';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, busy, onConfirm, children }: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-180 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-overlay transition-[opacity,transform] duration-180 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0">
          <AlertDialog.Title className="text-heading-sm">{title}</AlertDialog.Title>
          {description && <AlertDialog.Description className="mt-1 text-body text-muted-foreground">{description}</AlertDialog.Description>}
          {children}
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Close className="h-8 rounded-md px-3 text-body hover:bg-surface-2">Cancel</AlertDialog.Close>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className={cn(
                'h-8 rounded-md px-3 text-body font-medium disabled:opacity-50',
                destructive ? 'bg-danger text-white dark:text-background' : 'bg-brand text-brand-foreground hover:bg-brand/90',
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
