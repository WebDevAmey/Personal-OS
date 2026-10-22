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
          <h1 className="text-heading-lg text-foreground">{title}</h1>
          {description && <p className="mt-0.5 text-body text-muted-foreground">{description}</p>}
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
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {Icon && <Icon aria-hidden className="mb-3 size-6 text-subtle-foreground" />}
      <p className="text-heading-sm text-foreground">{title}</p>
      {children && <div className="mt-1 max-w-sm text-body text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
