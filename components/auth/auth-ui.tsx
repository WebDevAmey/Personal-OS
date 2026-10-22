// components/auth/auth-ui.tsx — shared markup for the sign-in, sign-up,
// code and password pages, on the docs/07 tokens.
import Link from 'next/link';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AuthShell({ title, description, children, footer }: { title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-[380px]">
        <Link href="/" className="mx-auto mb-6 flex w-fit items-center gap-2 rounded-md text-heading-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <span aria-hidden className="grid size-7 place-items-center rounded-md bg-foreground text-[0.6875rem] font-semibold text-background">
            OS
          </span>
          Personal OS
        </Link>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-popover sm:p-7">
          <h1 className="text-heading-lg text-foreground">{title}</h1>
          {description && <p className="mt-1 text-body text-muted-foreground">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 flex flex-col items-center gap-2 text-center text-body-sm text-muted-foreground">{footer}</div>}
      </div>
    </main>
  );
}

export function AuthLoading() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background" aria-busy="true">
      <Loader2 aria-label="Loading" className="size-5 animate-spin text-subtle-foreground" />
    </main>
  );
}

export const authInputCls =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-body text-foreground placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 aria-invalid:border-danger';

export function AuthField({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-meta text-subtle-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function AuthNotice({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2 rounded-md px-3 py-2 text-body-sm text-foreground', tone === 'error' ? 'bg-danger-subtle' : 'bg-success-subtle')}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', tone === 'error' ? 'text-danger' : 'text-success')} />
      <span>{children}</span>
    </div>
  );
}

export function AuthButton({
  children,
  variant = 'primary',
  loading,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary'; loading?: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-body font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' ? 'bg-brand text-brand-foreground hover:bg-brand/90' : 'border border-border bg-background text-foreground hover:bg-surface-2',
        className,
      )}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-meta text-subtle-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export const authLinkCls = 'font-medium text-foreground underline-offset-4 hover:underline';
