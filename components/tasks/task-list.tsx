'use client';
// components/tasks/task-list.tsx — the primary task view (FR-202/206/260).
//
// Keyboard (docs/07 §11.5), active only when focus is in the list and not in
// a text field: J/K or ↓/↑ move · X select · Shift+J/K extend selection ·
// E or Space complete/reopen · Enter or O open · D/P/M open the sheet on
// date/priority/project · Delete delete (confirmed) · ⌘A/Ctrl+A select all ·
// Esc clear selection · ⌘Z/Ctrl+Z undo the last change made here.
// Roving tabindex: the list is one Tab stop; the active row holds focus.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'motion/react';
import { CalendarDays, Check, Folder, Trash2, X, Flag } from 'lucide-react';
import { cn } from '@/components/app/cn';
import { notify } from '@/components/app/toast';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { useOptionalApp } from '@/components/app/app-context';
import { isEditableTarget } from '@/lib/hooks/use-keyboard';
import { ApiError, tasksApi } from './api';
import { groupHeading } from './format';
import { TaskRow } from './task-row';
import { useTaskActions } from './use-task-actions';
import { PRIORITY_LABELS, type ProjectDTO, type TaskDTO, type TaskListItemDTO } from './types';

export interface TaskListProps {
  items: TaskListItemDTO[];
  today: string;
  label: string;
  grouped?: boolean;
  empty?: React.ReactNode;
  projects?: ProjectDTO[];
  onOpen?: (id: string, field?: string) => void;
  /** Hide group headings for these groups (e.g. Today hides "today"). */
  hideGroups?: string[];
}

const BULK_CONFIRM_OVER = 25;

type BulkKind = 'complete' | 'delete' | 'due' | 'priority' | 'project';

export function TaskList({ items, today, label, grouped = false, empty, projects, onOpen, hideGroups = [] }: TaskListProps) {
  const app = useOptionalApp();
  const router = useRouter();
  const actions = useTaskActions();
  const [overrides, setOverrides] = useState<Record<string, TaskDTO>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: BulkKind; change: Record<string, unknown>; ids: string[]; count: number; titles: string[]; expected: { id: string; version: number }[] }>(null);
  const [busy, setBusy] = useState(false);
  const lastUndo = useRef<{ eventId: string } | { batchId: string } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const listRef = useRef<HTMLDivElement>(null);

  // Server data wins after every refresh.
  useEffect(() => setOverrides({}), [items]);

  const tasks = useMemo(() => items.map((i) => ({ group: i.group, task: overrides[i.task.id] ?? i.task })), [items, overrides]);
  const ids = useMemo(() => tasks.map((t) => t.task.id), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.task.id, t.task])), [tasks]);
  const projectList = projects ?? app?.projects ?? [];
  const projectName = (id: string | null) => (id ? (projectList.find((p) => p.id === id)?.name ?? null) : null);
  const active = activeId && byId.has(activeId) ? activeId : (ids[0] ?? null);

  useEffect(() => {
    if (app) app.focusedTaskRef.current = activeId && byId.has(activeId) ? activeId : null;
  }, [activeId, byId, app]);

  // Drop selections whose rows left the list.
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => byId.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [byId]);

  const open = useCallback((id: string, field?: string) => (onOpen ? onOpen(id, field) : app?.openTask(id, field)), [onOpen, app]);

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setActiveId(id);
    rowRefs.current.get(id)?.focus();
  };

  const toggleSelect = (id: string, range: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      if (range && anchor && byId.has(anchor)) {
        const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
        for (const rid of ids.slice(a, b + 1)) next.add(rid);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!range) setAnchor(id);
  };

  const complete = async (task: TaskDTO) => {
    const optimistic: TaskDTO = { ...task, status: task.status === 'DONE' ? 'TODO' : 'DONE' };
    setOverrides((o) => ({ ...o, [task.id]: optimistic }));
    const r = await actions.toggleComplete(task);
    if (!r) setOverrides((o) => ({ ...o, [task.id]: task }));
    else setOverrides((o) => ({ ...o, [task.id]: r }));
  };

  // ── bulk ──
  const selectedIds = ids.filter((id) => selected.has(id));
  const runBulk = async (kind: BulkKind, change: Record<string, unknown>, targetIds = selectedIds) => {
    if (!targetIds.length) return;
    try {
      if (kind === 'delete' || targetIds.length > BULK_CONFIRM_OVER) {
        const preview = await tasksApi.bulkPreview(targetIds, change);
        setConfirm({ kind, change, ids: targetIds, ...preview });
        return;
      }
      await applyBulk(kind, change, targetIds);
    } catch (e) {
      notify({ title: "Couldn't update those tasks", description: e instanceof ApiError ? e.message : undefined, tone: 'error' });
    }
  };

  const applyBulk = async (kind: BulkKind, change: Record<string, unknown>, targetIds: string[], expected?: { id: string; version: number }[]) => {
    setBusy(true);
    try {
      const r = await tasksApi.bulkApply(targetIds, change, expected);
      lastUndo.current = { batchId: r.batchId };
      const verb = { complete: 'Completed', delete: 'Deleted', due: 'Rescheduled', priority: 'Updated priority of', project: 'Moved' }[kind];
      notify({
        title: `${verb} ${r.tasks.length} task${r.tasks.length === 1 ? '' : 's'}`,
        tone: 'success',
        action: { label: 'Undo', run: () => actions.undo({ batchId: r.batchId }) },
      });
      setSelected(new Set());
      setConfirm(null);
      router.refresh();
    } catch (e) {
      notify({ title: "Couldn't update those tasks", description: e instanceof ApiError ? e.message : undefined, tone: 'error' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isEditableTarget(e.target) || e.altKey) return;
    if (app && !app.shortcutsEnabled && !['ArrowDown', 'ArrowUp', 'Enter', 'Escape', ' '].includes(e.key)) return;
    const idx = active ? ids.indexOf(active) : -1;
    const cur = active ? byId.get(active) : undefined;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod && key === 'a') {
      e.preventDefault();
      setSelected(new Set(ids));
      return;
    }
    if (mod && key === 'z') {
      if (lastUndo.current) {
        e.preventDefault();
        const token = lastUndo.current;
        lastUndo.current = null;
        void actions.undo(token);
      }
      return;
    }
    if (mod) return;
    switch (key) {
      case 'j':
      case 'ArrowDown': {
        e.preventDefault();
        const next = ids[Math.min(idx + 1, ids.length - 1)];
        if (e.shiftKey && cur && next) {
          setSelected((s) => new Set(s).add(cur.id).add(next));
        }
        focusRow(next);
        break;
      }
      case 'k':
      case 'ArrowUp': {
        e.preventDefault();
        const prev = ids[Math.max(idx - 1, 0)];
        if (e.shiftKey && cur && prev) {
          setSelected((s) => new Set(s).add(cur.id).add(prev));
        }
        focusRow(prev);
        break;
      }
      case 'Home':
        e.preventDefault();
        focusRow(ids[0]);
        break;
      case 'End':
        e.preventDefault();
        focusRow(ids[ids.length - 1]);
        break;
      case 'x':
        if (cur) {
          e.preventDefault();
          toggleSelect(cur.id, e.shiftKey);
        }
        break;
      case 'e':
      case ' ':
        if (cur) {
          e.preventDefault();
          void complete(cur);
        }
        break;
      case 'Enter':
      case 'o':
        if (cur) {
          e.preventDefault();
          open(cur.id);
        }
        break;
      case 'd':
      case 'p':
      case 'm':
        if (cur) {
          e.preventDefault();
          open(cur.id, key === 'd' ? 'due' : key === 'p' ? 'priority' : 'project');
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (cur) {
          e.preventDefault();
          void runBulk('delete', { delete: true }, selected.size ? selectedIds : [cur.id]);
        }
        break;
      case 'Escape':
        if (selected.size) {
          e.preventDefault();
          setSelected(new Set());
        }
        break;
    }
  };

  if (tasks.length === 0) return <>{empty}</>;

  // Group consecutive rows for headings.
  const sections: { group: string | null; rows: typeof tasks }[] = [];
  for (const row of tasks) {
    const g = grouped ? row.group : null;
    const last = sections[sections.length - 1];
    if (last && last.group === g) last.rows.push(row);
    else sections.push({ group: g, rows: [row] });
  }

  return (
    <div ref={listRef} onKeyDown={onKeyDown} className="group/list flex flex-col gap-4">
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          projects={projectList}
          busy={busy}
          onClear={() => setSelected(new Set())}
          onComplete={() => runBulk('complete', { complete: true })}
          onDelete={() => runBulk('delete', { delete: true })}
          onDue={(date) => runBulk('due', { due: date ? { date } : null })}
          onPriority={(p) => runBulk('priority', { priority: p })}
          onProject={(id) => runBulk('project', { projectId: id })}
        />
      )}
      {sections.map((section, si) => {
        const heading = section.group && !hideGroups.includes(section.group) ? groupHeading(section.group, today) : null;
        const headingId = heading ? `grp-${label.replace(/\W+/g, '-')}-${si}` : undefined;
        return (
          <section key={`${section.group}-${si}`} aria-labelledby={headingId}>
            {heading && (
              <h3 id={headingId} className={cn('mb-1 px-2 text-meta font-medium', section.group === 'overdue' ? 'text-danger' : 'text-subtle-foreground')}>
                {heading} <span className="tabular font-normal">· {section.rows.length}</span>
              </h3>
            )}
            <ul aria-label={heading ? `${label}: ${heading}` : label} className="flex flex-col">
              <AnimatePresence initial={false}>
                {section.rows.map(({ task }) => (
                  <TaskRow
                      key={task.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(task.id, el);
                        else rowRefs.current.delete(task.id);
                      }}
                      task={task}
                      today={today}
                      projectName={projectName(task.projectId)}
                      active={task.id === active}
                      selected={selected.has(task.id)}
                      selectionMode={selected.size > 0}
                      onFocusRow={() => setActiveId(task.id)}
                      onToggleComplete={() => void complete(task)}
                      onToggleSelect={(range) => toggleSelect(task.id, range)}
                      onOpen={() => open(task.id)}
                    />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        );
      })}
      <p className="hidden px-2 text-meta text-subtle-foreground md:block">
        <span className="sr-only">Keyboard: </span>J/K to move · X to select · E to complete · Enter to open
      </p>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm.kind === 'delete' ? `Delete ${confirm.count} task${confirm.count === 1 ? '' : 's'}?` : `Change ${confirm.count} tasks?`}
          description={confirm.kind === 'delete' ? 'You can undo this, and deleted tasks can be restored for 30 days.' : 'One Undo will revert all of them.'}
          confirmLabel={confirm.kind === 'delete' ? 'Delete' : 'Apply'}
          destructive={confirm.kind === 'delete'}
          busy={busy}
          onConfirm={() => void applyBulk(confirm.kind, confirm.change, confirm.ids, confirm.expected)}
        >
          <ul className="mt-3 max-h-48 list-disc overflow-y-auto pl-5 text-body-sm text-foreground">
            {confirm.titles.map((t, i) => (
              <li key={i} className="truncate">
                {t}
              </li>
            ))}
            {confirm.count > confirm.titles.length && <li className="list-none text-muted-foreground">and {confirm.count - confirm.titles.length} more</li>}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}

function BulkBar({
  count,
  projects,
  busy,
  onClear,
  onComplete,
  onDelete,
  onDue,
  onPriority,
  onProject,
}: {
  count: number;
  projects: ProjectDTO[];
  busy: boolean;
  onClear: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onDue: (date: string | null) => void;
  onPriority: (p: number) => void;
  onProject: (id: string | null) => void;
}) {
  const btn = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-body hover:bg-surface disabled:opacity-50';
  const sel = 'h-8 rounded-md border border-border-strong bg-surface px-2 text-body';
  return (
    <div role="toolbar" aria-label={`${count} selected`} className="sticky top-[calc(var(--topbar-h)+8px)] z-10 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-2 p-1.5 shadow-popover">
      <span className="px-2 text-body font-medium tabular" aria-live="polite">
        {count} selected
      </span>
      <button type="button" className={btn} onClick={onComplete} disabled={busy}>
        <Check aria-hidden className="size-4" /> Complete
      </button>
      <label className="inline-flex items-center gap-1.5 px-1 text-body">
        <CalendarDays aria-hidden className="size-4 text-subtle-foreground" />
        <span className="sr-only">Set due date for selected tasks</span>
        <input type="date" className={sel} disabled={busy} onChange={(e) => e.target.value && onDue(e.target.value)} />
      </label>
      <label className="inline-flex items-center gap-1.5 px-1">
        <Flag aria-hidden className="size-4 text-subtle-foreground" />
        <span className="sr-only">Set priority for selected tasks</span>
        <select className={sel} disabled={busy} defaultValue="" onChange={(e) => e.target.value !== '' && onPriority(Number(e.target.value))}>
          <option value="" disabled>
            Priority
          </option>
          {[4, 3, 2, 1, 0].map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-flex items-center gap-1.5 px-1">
        <Folder aria-hidden className="size-4 text-subtle-foreground" />
        <span className="sr-only">Move selected tasks to project</span>
        <select className={sel} disabled={busy} defaultValue="" onChange={(e) => e.target.value !== '' && onProject(e.target.value === 'none' ? null : e.target.value)}>
          <option value="" disabled>
            Project
          </option>
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={cn(btn, 'text-danger')} onClick={onDelete} disabled={busy}>
        <Trash2 aria-hidden className="size-4" /> Delete
      </button>
      <button type="button" className={cn(btn, 'ml-auto')} onClick={onClear} aria-label="Clear selection">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
