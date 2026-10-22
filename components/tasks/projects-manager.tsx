'use client';
// components/tasks/projects-manager.tsx — project list with create, rename,
// archive and delete (FR-240..FR-244). Deleting asks first and says what
// happens to the tasks.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, Folder, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { notify } from '@/components/app/toast';
import { EmptyState } from '@/components/app/page-header';
import { ApiError, projectsApi } from './api';
import { inputCls } from './task-detail';
import type { ProjectDTO } from './types';

const iconBtn =
  'grid size-8 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

function failed(e: unknown, what: string) {
  notify({
    title: e instanceof ApiError && e.isConflict ? 'This project was changed elsewhere — reloaded' : `Couldn't ${what}`,
    description: e instanceof ApiError && !e.isConflict ? e.message : undefined,
    tone: 'error',
  });
}

export function ProjectsManager({ projects, archived }: { projects: ProjectDTO[]; archived: ProjectDTO[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ProjectDTO | null>(null);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await projectsApi.create(n);
      setName('');
      notify({ title: `Created ${n}`, tone: 'success' });
      router.refresh();
    } catch (e) {
      failed(e, 'create the project');
    } finally {
      setBusy(false);
    }
  };

  const update = async (p: ProjectDTO, patch: { name?: string; archived?: boolean }, what: string) => {
    try {
      await projectsApi.update(p.id, p.version, patch);
      if (patch.archived !== undefined) notify({ title: patch.archived ? `Archived ${p.name}` : `Restored ${p.name}`, tone: 'success' });
    } catch (e) {
      failed(e, what);
    }
    setEditing(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor="new-project" className="sr-only">
          New project name
        </label>
        <input id="new-project" className={`${inputCls} h-9 max-w-sm`} placeholder="New project name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-body font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
        >
          <Plus aria-hidden className="size-4" /> Create
        </button>
      </form>

      {projects.length === 0 ? (
        <EmptyState icon={Folder} title="No projects yet">
          Group related tasks — “Kitchen renovation”, “Job search”. Add #project to any task to file it.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: p.color ?? 'var(--border-strong)' }} />
              {editing === p.id ? (
                <RenameField project={p} onDone={(n) => (n && n !== p.name ? void update(p, { name: n }, 'rename the project') : setEditing(null))} />
              ) : (
                <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 truncate text-body text-foreground hover:underline">
                  {p.name}
                </Link>
              )}
              <span className="tabular shrink-0 text-meta text-subtle-foreground">
                {p.openTaskCount} open
              </span>
              <div className="flex shrink-0">
                <button type="button" className={iconBtn} aria-label={`Rename ${p.name}`} onClick={() => setEditing(p.id)}>
                  <Pencil aria-hidden className="size-4" />
                </button>
                <button type="button" className={iconBtn} aria-label={`Archive ${p.name}`} onClick={() => void update(p, { archived: true }, 'archive the project')}>
                  <Archive aria-hidden className="size-4" />
                </button>
                <button type="button" className={iconBtn} aria-label={`Delete ${p.name}`} onClick={() => setToDelete(p)}>
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section aria-labelledby="archived-projects">
          <h2 id="archived-projects" className="mb-2 text-heading-sm text-muted-foreground">
            Archived
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {archived.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">{p.name}</span>
                <button type="button" className={iconBtn} aria-label={`Restore ${p.name}`} onClick={() => void update(p, { archived: false }, 'restore the project')}>
                  <ArchiveRestore aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {toDelete && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setToDelete(null)}
          title={`Delete ${toDelete.name}?`}
          description={
            toDelete.openTaskCount
              ? `Its ${toDelete.openTaskCount} open task${toDelete.openTaskCount === 1 ? '' : 's'} stay in your task lists.`
              : 'The project has no open tasks.'
          }
          confirmLabel="Delete project"
          destructive
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try {
              await projectsApi.remove(toDelete.id, toDelete.version);
              notify({ title: `Deleted ${toDelete.name}`, tone: 'success' });
              router.refresh();
            } catch (e) {
              failed(e, 'delete the project');
            } finally {
              setBusy(false);
              setToDelete(null);
            }
          }}
        />
      )}
    </div>
  );
}

function RenameField({ project, onDone }: { project: ProjectDTO; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(project.name);
  return (
    <input
      autoFocus
      aria-label={`Rename ${project.name}`}
      className={`${inputCls} flex-1`}
      value={v}
      maxLength={100}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim() || null);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}
