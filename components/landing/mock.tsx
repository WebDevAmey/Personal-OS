import * as React from "react";
import { cx as cn } from "@/components/ui/class-names";

/* Small pieces of the real app, drawn with the app's tokens, for the
   feature previews. They are illustrations: aria-hidden is set by the caller
   when the surrounding copy already says the same thing. */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-background px-1 font-mono text-[0.6875rem] font-medium text-muted-foreground", className)}>
      {children}
    </kbd>
  );
}

export function SourceChip({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm border border-border bg-background px-1.5 text-meta text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-md border border-border bg-background", className)} {...props} />;
}

export function Token({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[3px] bg-brand-subtle px-1 text-brand">{children}</span>;
}
