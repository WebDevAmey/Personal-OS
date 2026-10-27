// components/app/page-header.tsx — page title row (docs/07 §6.3).
import { cn } from './cn';

export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn('flex flex-col gap-3 pb-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-serif text-[2.25rem] leading-[1.05] tracking-[-0.015em] text-foreground">{title}</h1>
          {description && <p className="mt-1 text-body text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function PageContainer({ children, wide, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:py-8', wide ? 'max-w-[1240px]' : 'max-w-[var(--content-max)]', className)}>{children}</div>;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong/40 px-6 py-12 text-center">
      {Icon && (
        <span className="mb-3 grid size-11 place-items-center rounded-xl bg-surface text-subtle-foreground shadow-card">
          <Icon aria-hidden className="size-5" />
        </span>
      )}
      <p className="text-heading-sm text-foreground">{title}</p>
      {children && <div className="mt-1 max-w-sm text-body text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
