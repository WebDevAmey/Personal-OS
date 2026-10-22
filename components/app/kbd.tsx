import { cn } from '@/components/app/cn';

/** Keyboard hint (docs/07 §9): Geist Mono, 4px radius, surface-2, 1px border. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-[0.75rem] leading-none font-medium text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
