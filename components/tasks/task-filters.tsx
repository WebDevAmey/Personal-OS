'use client';
// components/tasks/task-filters.tsx — sort / filter / group controls for a
// task view. State lives in the URL so views are linkable and Back works.
import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { useApp } from '@/components/app/app-context';
import { cn } from '@/components/app/cn';
import { PRIORITY_LABELS } from './types';

const selectCls =
  'h-8 max-w-40 rounded-md border border-border bg-background pr-7 pl-2 text-body-sm text-foreground hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring';

export interface TaskFiltersProps {
  /** Which controls this view offers. */
  show: { sort?: boolean; priority?: boolean; project?: boolean; tag?: boolean; group?: boolean; status?: boolean; search?: boolean };
}

export function TaskFilters({ show }: TaskFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const app = useApp();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get('q') ?? '');

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('cursor');
    const s = next.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  // Debounced search-as-you-type.
  useEffect(() => {
    if (!show.search) return;
    const current = params.get('q') ?? '';
    if (q.trim() === current) return;
    const h = setTimeout(() => set('q', q.trim() || null), 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ['priority', 'projectId', 'tag', 'status'].filter((k) => params.get(k));

  return (
    <div role="group" aria-label="View options" className="flex flex-wrap items-center gap-2">
      {show.search && (
        <div className="relative w-full sm:w-72">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground" />
          <input
            type="search"
            aria-label="Search tasks"
            placeholder="Search tasks — try “dentist” or “status:done”"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background pr-2 pl-8 text-body text-foreground placeholder:text-subtle-foreground hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring"
          />
        </div>
      )}
      {show.sort && (
        <label className="flex items-center gap-1.5 text-meta text-subtle-foreground">
          Sort
          <select className={selectCls} value={params.get('sort') ?? 'default'} onChange={(e) => set('sort', e.target.value === 'default' ? null : e.target.value)}>
            <option value="default">Smart</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="created">Newest</option>
            <option value="updated">Recently changed</option>
            <option value="title">Title</option>
          </select>
        </label>
      )}
      {show.priority && (
        <label className="flex items-center gap-1.5 text-meta text-subtle-foreground">
          Priority
          <select className={selectCls} value={params.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value || null)}>
            <option value="">Any</option>
            {[4, 3, 2, 1, 0].map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.project && app.projects.length > 0 && (
        <label className="flex items-center gap-1.5 text-meta text-subtle-foreground">
          Project
          <select className={cn(selectCls, 'max-w-40')} value={params.get('projectId') ?? ''} onChange={(e) => set('projectId', e.target.value || null)}>
            <option value="">Any</option>
            {app.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.status && (
        <label className="flex items-center gap-1.5 text-meta text-subtle-foreground">
          Status
          <select className={selectCls} value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value || null)}>
            <option value="">Open</option>
            <option value="INBOX">Inbox</option>
            <option value="TODO">To do</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="INBOX,TODO,IN_PROGRESS,DONE,CANCELLED">All, including done</option>
          </select>
        </label>
      )}
      {show.group && (
        <label className="flex items-center gap-1.5 text-meta text-subtle-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--brand)]"
            checked={params.get('group') !== 'none'}
            onChange={(e) => set('group', e.target.checked ? null : 'none')}
          />
          Group
        </label>
      )}
      {params.get('tag') && (
        <span className="inline-flex h-7 items-center gap-1 rounded-md bg-surface-2 pr-1 pl-2 text-meta text-foreground">
          #{params.get('tag')}
          <button type="button" aria-label={`Remove tag filter ${params.get('tag')}`} className="grid size-5 place-items-center rounded hover:bg-border" onClick={() => set('tag', null)}>
            <X aria-hidden className="size-3" />
          </button>
        </span>
      )}
      {active.length > 0 && (
        <button
          type="button"
          className="h-8 rounded-md px-2 text-meta text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            for (const k of active) next.delete(k);
            const s = next.toString();
            start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
          }}
        >
          Clear filters
        </button>
      )}
      {pending && <Loader2 aria-label="Updating" className="size-4 animate-spin text-subtle-foreground" />}
    </div>
  );
}
