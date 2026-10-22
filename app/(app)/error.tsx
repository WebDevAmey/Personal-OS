'use client';
// app/(app)/error.tsx — a page failed to load; the shell stays usable.
import { CircleAlert } from 'lucide-react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col items-start gap-3 px-4 py-12 sm:px-6" role="alert">
      <CircleAlert aria-hidden className="size-6 text-danger" />
      <h1 className="text-heading text-foreground">This page couldn&rsquo;t load</h1>
      <p className="text-body text-muted-foreground">
        Something went wrong on our side. Your data is safe. Try again, or use ⌘K to get where you were going.
        {error.digest && <span className="mt-1 block font-mono text-meta text-subtle-foreground">Reference {error.digest}</span>}
      </p>
      <button type="button" onClick={reset} className="h-8 rounded-md bg-brand px-3 text-body font-medium text-brand-foreground hover:bg-brand/90">
        Try again
      </button>
    </div>
  );
}
