'use client';
// components/settings/memory-manager.tsx — what Personal OS remembers about
// the user (FR-801..FR-806): add, edit, delete with undo, restore within 30
// days, and text search. Memory is the user's own data, shown verbatim.
import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BookMarked, Loader2, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react';
import { cn } from '@/components/app/cn';
import { notify } from '@/components/app/toast';
import { EmptyState } from '@/components/app/page-header';
import { ApiError, request } from '@/components/tasks/api';
import { inputCls } from '@/components/tasks/task-detail';
import type { MemoryDTO } from './types';

const SOURCE_LABEL: Record<string, string> = { MANUAL: 'Added by you', COMMAND: 'From a command', IMPORTED: 'Imported' };
const iconBtn =
  'grid size-8 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

const memoryApi = {
  create: (content: string) => request<{ memory: MemoryDTO }>('/api/memory', { method: 'POST', json: { content } }),
  update: (id: string, content: string) => request<{ memory: MemoryDTO }>(`/api/memory/${encodeURIComponent(id)}`, { method: 'PATCH', json: { content } }),
  remove: (id: string) => request<{ memory: MemoryDTO }>(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restore: (id: string) => request<{ memory: MemoryDTO }>(`/api/memory/${encodeURIComponent(id)}`, { method: 'POST', json: {} }),
};

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function MemoryManager({ items, deleted, query }: { items: MemoryDTO[]; deleted: MemoryDTO[]; query: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(query);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim() === query) return;
    const h = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set('q', q.trim());
      else next.delete('q');
      const s = next.toString();
      start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
    }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const fail = (e: unknown, what: string) => notify({ title: `Couldn't ${what}`, description: e instanceof ApiError ? e.message : undefined, tone: 'error' });

  const add = async () => {
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    try {
      await memoryApi.create(content);
      setDraft('');
      notify({ title: 'Saved to memory', tone: 'success' });
      router.refresh();
    } catch (e) {
      fail(e, 'save that');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: MemoryDTO) => {
    try {
      await memoryApi.remove(m.id);
      notify({
        title: 'Memory deleted',
        description: 'Restorable for 30 days.',
        tone: 'success',
        action: {
          label: 'Undo',
          run: async () => {
            await memoryApi.restore(m.id).catch((e) => fail(e, 'restore it'));
            router.refresh();
          },
        },
      });
      router.refresh();
    } catch (e) {
      fail(e, 'delete it');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label htmlFor="memory-new" className="text-body-sm font-medium text-foreground">
          Remember something
        </label>
        <textarea
          id="memory-new"
          rows={2}
          maxLength={4000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. My manager is Priya. I prefer meetings after 10am."
          className={cn(inputCls, 'field-sizing-content h-auto min-h-16 resize-y py-1.5')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-meta text-subtle-foreground">Personal OS uses these to answer questions and shape your briefing.</p>
          <button type="submit" disabled={busy || !draft.trim()} className="inline-flex h-8 shrink-0 items-center rounded-md bg-brand px-3 text-body font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50">
            Save
          </button>
        </div>
      </form>

      <div className="relative max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground" />
        <input type="search" aria-label="Search memory" placeholder="Search memory" value={q} onChange={(e) => setQ(e.target.value)} className={cn(inputCls, 'h-9 pl-8')} />
        {pending && <Loader2 aria-label="Searching" className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-subtle-foreground" />}
      </div>

      {items.length === 0 ? (
        <EmptyState icon={BookMarked} title={query ? 'Nothing matches' : 'Nothing remembered yet'}>
          {query ? 'Try a different word.' : 'Add facts above, or say “remember that…” in the command palette.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {items.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                {editing === m.id ? (
                  <EditField
                    memory={m}
                    onDone={async (content) => {
                      setEditing(null);
                      if (content && content !== m.content) {
                        try {
                          await memoryApi.update(m.id, content);
                          router.refresh();
                        } catch (e) {
                          fail(e, 'save the change');
                        }
                      }
                    }}
                  />
                ) : (
                  <p className="text-body whitespace-pre-wrap text-foreground">{m.content}</p>
                )}
                <p className="mt-0.5 text-meta text-subtle-foreground">
                  {SOURCE_LABEL[m.source] ?? m.source} · {dateLabel(m.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0">
                <button type="button" className={iconBtn} aria-label="Edit memory" onClick={() => setEditing(m.id)}>
                  <Pencil aria-hidden className="size-4" />
                </button>
                <button type="button" className={iconBtn} aria-label="Delete memory" onClick={() => void remove(m)}>
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleted.length > 0 && (
        <section aria-labelledby="memory-deleted">
          <h2 id="memory-deleted" className="mb-2 text-heading-sm text-muted-foreground">
            Recently deleted
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {deleted.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-body text-muted-foreground">{m.content}</p>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-body-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  onClick={async () => {
                    try {
                      await memoryApi.restore(m.id);
                      router.refresh();
                    } catch (e) {
                      fail(e, 'restore it');
                    }
                  }}
                >
                  <RotateCcw aria-hidden className="size-4" /> Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EditField({ memory, onDone }: { memory: MemoryDTO; onDone: (content: string | null) => void }) {
  const [v, setV] = useState(memory.content);
  return (
    <textarea
      autoFocus
      aria-label="Edit memory"
      value={v}
      maxLength={4000}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone(null);
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onDone(v.trim() || null);
      }}
      className={cn(inputCls, 'field-sizing-content h-auto min-h-16 resize-y py-1.5')}
    />
  );
}
