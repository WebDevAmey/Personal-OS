'use client';
// components/tasks/task-detail.tsx — every field of one task, editable in
// place (FR-201..FR-262): status, due, priority, project, tags, estimate,
// recurrence, snooze, notes, subtasks, dependencies, reminders and history
// with undo. Saves are per field with optimistic concurrency; a 409 reloads.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, Bell, Check, History, Link2, Loader2, Plus, Repeat, Trash2, Undo2, X } from 'lucide-react';
import { addDays } from '@/lib/time';
import { useOptionalApp } from '@/components/app/app-context';
import { cn } from '@/components/app/cn';
import { notify } from '@/components/app/toast';
import { ApiError, tasksApi, type TaskPatch } from './api';
import { dueText, PriorityGlyph } from './format';
import { useTaskActions } from './use-task-actions';
import { PRIORITY_LABELS, type LocalDateTime, type TaskDetailDTO, type TaskDTO, type TaskEventDTO } from './types';

export const inputCls =
  'h-8 w-full min-w-0 rounded-md border border-border bg-background px-2 text-body text-foreground placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:opacity-50';
const ghostBtn =
  'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-body text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

const REPEAT_PRESETS: { value: string; label: string }[] = [
  { value: '', label: 'Does not repeat' },
  { value: 'FREQ=DAILY', label: 'Every day' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Every weekday' },
  { value: 'FREQ=WEEKLY', label: 'Every week' },
  { value: 'FREQ=MONTHLY', label: 'Every month' },
  { value: 'FREQ=YEARLY', label: 'Every year' },
];

/** Drop the wall-time parts the server pins onto rules so presets still match. */
function presetOf(rule: string | null): string {
  if (!rule) return '';
  const core = rule
    .split(';')
    .filter((p) => !/^(BYHOUR|BYMINUTE|BYSECOND|WKST)=/.test(p))
    .join(';');
  const day = core.replace(/;BYDAY=[A-Z]{2}$/, '');
  if (REPEAT_PRESETS.some((p) => p.value === core)) return core;
  if (day === 'FREQ=WEEKLY' && !core.includes(',')) return 'FREQ=WEEKLY';
  if (/^FREQ=MONTHLY;BYMONTHDAY=\d+$/.test(core)) return 'FREQ=MONTHLY';
  return 'custom';
}

const EVENT_LABELS: Record<string, string> = {
  IMPORTED: 'Imported',
  CREATED: 'Created',
  UPDATED: 'Edited',
  STATUS_CHANGED: 'Changed status',
  COMPLETED: 'Completed',
  REOPENED: 'Reopened',
  SNOOZED: 'Snoozed',
  MOVED: 'Moved',
  ARCHIVED: 'Archived',
  UNARCHIVED: 'Unarchived',
  DELETED: 'Deleted',
  RESTORED: 'Restored',
  DEPENDENCY_ADDED: 'Added a dependency',
  DEPENDENCY_REMOVED: 'Removed a dependency',
  REMINDER_SET: 'Set a reminder',
  REMINDER_CLEARED: 'Cleared a reminder',
  RECURRENCE_ROLLED: 'Next occurrence created',
  UNDONE: 'Undid a change',
};
const FIELD_NAMES: Record<string, string> = {
  title: 'title',
  description: 'notes',
  dueAt: 'due date',
  dueHasTime: 'due time',
  startAt: 'start',
  priority: 'priority',
  projectId: 'project',
  tags: 'tags',
  estimateMinutes: 'estimate',
  recurrenceRule: 'repeat',
  status: 'status',
  parentId: 'parent task',
  snoozedUntil: 'snooze',
};
const NOT_UNDOABLE = new Set(['IMPORTED', 'UNDONE', 'RECURRENCE_ROLLED']);

function describeEvent(e: TaskEventDTO): string {
  const base = EVENT_LABELS[e.type] ?? e.type.toLowerCase().replace(/_/g, ' ');
  if (e.type === 'UPDATED' && e.after) {
    const fields = Object.keys(e.after)
      .map((k) => FIELD_NAMES[k])
      .filter(Boolean);
    if (fields.length) return `Changed ${[...new Set(fields)].join(', ')}`;
  }
  return base;
}

function actorOf(e: TaskEventDTO): string | null {
  if (e.source === 'VOICE') return 'by voice';
  if (e.source === 'COMMAND') return 'from a command';
  if (e.source === 'BRIEFING') return 'from the briefing';
  if (e.source === 'EMAIL') return 'from an email';
  return null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Section({ title, icon: Icon, children, action }: { title: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; children: React.ReactNode; action?: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-border pt-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon aria-hidden className="size-4 text-subtle-foreground" />
        <h3 id={id} className="text-heading-sm text-foreground">
          {title}
        </h3>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-3 sm:grid-cols-[112px_1fr]">
      <label htmlFor={htmlFor} className="text-body-sm text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export interface TaskDetailProps {
  taskId: string;
  /** Field to focus on open: due, priority, project, title, notes. */
  field?: string | null;
  /** Called after delete; the sheet closes, the page navigates back. */
  onDeleted?: () => void;
  /** Rendered in the header (the sheet's close button). */
  headerEnd?: React.ReactNode;
  titleId?: string;
}

export function TaskDetail({ taskId, field, onDeleted, headerEnd, titleId }: TaskDetailProps) {
  const router = useRouter();
  const app = useOptionalApp();
  const actions = useTaskActions();
  const today = app?.today ?? localToday();
  const projects = app?.projects ?? [];
  const [detail, setDetail] = useState<TaskDetailDTO | null>(null);
  const [events, setEvents] = useState<TaskEventDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const ids = {
    title: useId(),
    status: useId(),
    due: useId(),
    time: useId(),
    priority: useId(),
    project: useId(),
    tags: useId(),
    estimate: useId(),
    repeat: useId(),
    notes: useId(),
  };
  const focusDone = useRef(false);

  const load = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([tasksApi.detail(taskId), tasksApi.history(taskId)]);
      setDetail(d);
      setEvents(h.events);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError && e.status === 404 ? 'This task no longer exists.' : "Couldn't load this task.");
    }
  }, [taskId]);

  useEffect(() => {
    focusDone.current = false;
    setDetail(null);
    setEvents(null);
    void load();
  }, [load]);

  // Focus the field a shortcut asked for (D / P / M on a row) once loaded.
  useEffect(() => {
    if (!detail || focusDone.current || !field) return;
    focusDone.current = true;
    const target = { due: ids.due, priority: ids.priority, project: ids.project, title: ids.title, notes: ids.notes }[field];
    if (target) requestAnimationFrame(() => document.getElementById(target)?.focus());
  }, [detail, field, ids.due, ids.priority, ids.project, ids.title, ids.notes]);

  const save = useCallback(
    async (name: string, patch: TaskPatch) => {
      if (!detail) return;
      setSaving(name);
      setFieldError(null);
      try {
        const r = await tasksApi.update(detail.task.id, detail.task.version, patch);
        setDetail((d) => (d ? { ...d, task: r.task } : d));
        router.refresh();
        void tasksApi.history(taskId).then((h) => setEvents(h.events), () => undefined);
      } catch (e) {
        if (e instanceof ApiError && e.isConflict) {
          notify({ title: 'This task was changed elsewhere', description: 'We reloaded the latest version.', tone: 'error' });
          await load();
        } else if (e instanceof ApiError && (e.status === 400 || e.status === 422)) {
          setFieldError({ field: e.body.field ?? name, message: e.message });
        } else {
          actions.fail(e, 'save the change');
        }
      } finally {
        setSaving(null);
      }
    },
    [detail, router, taskId, load, actions],
  );

  const runAndReload = useCallback(
    async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        await load();
        router.refresh();
      } catch (e) {
        actions.fail(e, what);
        await load();
      }
    },
    [load, router, actions],
  );

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 p-6" role="alert">
        <p className="text-body text-foreground">{loadError}</p>
        <div className="flex gap-2">
          <button type="button" className={ghostBtn} onClick={() => void load()}>
            Try again
          </button>
          {headerEnd}
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true" aria-label="Loading task">
        <div className="flex items-center justify-between">
          <div className="h-6 w-2/3 animate-pulse rounded bg-surface-2" />
          {headerEnd}
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-surface-2" />
        ))}
      </div>
    );
  }

  const t = detail.task;
  const closed = t.status === 'DONE' || t.status === 'CANCELLED';
  const deleted = Boolean(t.deletedAt);
  const preset = presetOf(t.recurrenceRule);
  const blockers = detail.dependsOn.filter((d) => detail.openBlockerIds.includes(d.id));
  const snoozed = t.snoozedUntil && new Date(t.snoozedUntil).getTime() > Date.now();
  const errFor = (f: string) =>
    fieldError && fieldError.field === f ? (
      <p role="alert" className="col-span-2 -mt-1 text-meta text-danger sm:pl-[124px]">
        {fieldError.message}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={t.status === 'DONE'}
          aria-label={t.status === 'DONE' ? 'Reopen task' : 'Complete task'}
          disabled={deleted}
          onClick={async () => {
            const r = await actions.toggleComplete(t);
            if (r) {
              setDetail((d) => (d ? { ...d, task: r } : d));
              void tasksApi.history(taskId).then((h) => setEvents(h.events), () => undefined);
            }
          }}
          className="mt-1 grid size-6 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span
            className={cn(
              'grid size-[18px] place-items-center rounded-full border',
              t.status === 'DONE' ? 'border-success bg-success text-background' : 'border-border-strong hover:border-foreground',
            )}
          >
            {t.status === 'DONE' && <Check aria-hidden className="size-3" strokeWidth={3} />}
          </span>
        </button>
        <TitleField key={`${t.id}-${t.version}`} id={ids.title} titleId={titleId} value={t.title} closed={closed} onSave={(title) => save('title', { title })} />
        <div className="flex shrink-0 items-center gap-1">{headerEnd}</div>
      </header>
      {errFor('title')}

      {deleted && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-warning-subtle px-3 py-2 text-body-sm text-foreground" role="status">
          This task is deleted.
          <button type="button" className={ghostBtn} onClick={() => void runAndReload('restore the task', () => tasksApi.action(t.id, { action: 'restore' }))}>
            Restore
          </button>
        </div>
      )}
      {blockers.length > 0 && !closed && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-body-sm text-muted-foreground">
          Waiting on {blockers.length === 1 ? blockers[0].title : `${blockers.length} open tasks`}.
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        <Row label="Status" htmlFor={ids.status}>
          {closed ? (
            <span className="text-body text-foreground">{t.status === 'DONE' ? 'Done' : 'Cancelled'}</span>
          ) : (
            <select
              id={ids.status}
              className={inputCls}
              value={t.status}
              disabled={deleted || saving === 'status'}
              onChange={(e) => void save('status', { status: e.target.value as TaskPatch['status'] })}
            >
              <option value="INBOX">Inbox</option>
              <option value="TODO">To do</option>
              <option value="IN_PROGRESS">In progress</option>
            </select>
          )}
        </Row>
        <Row label="Due" htmlFor={ids.due}>
          <DueField key={`${t.id}-${t.version}-due`} dateId={ids.due} timeId={ids.time} value={t.due} disabled={deleted} onSave={(due) => save('due', { due })} />
        </Row>
        {errFor('due')}
        <Row label="Priority" htmlFor={ids.priority}>
          <select
            id={ids.priority}
            className={inputCls}
            value={t.priority}
            disabled={deleted}
            onChange={(e) => void save('priority', { priority: Number(e.target.value) })}
          >
            {[4, 3, 2, 1, 0].map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <PriorityGlyph priority={t.priority} />
        </Row>
        <Row label="Project" htmlFor={ids.project}>
          <select
            id={ids.project}
            className={inputCls}
            value={t.projectId ?? ''}
            disabled={deleted}
            onChange={(e) => void save('projectId', { projectId: e.target.value || null })}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Tags" htmlFor={ids.tags}>
          <TextCommit
            key={`${t.id}-${t.version}-tags`}
            id={ids.tags}
            value={t.tags.join(', ')}
            placeholder="Comma separated, e.g. errands, home"
            disabled={deleted}
            onSave={(v) =>
              save('tags', {
                tags: [...new Set(v.split(',').map((s) => s.trim().replace(/^[#@]/, '')).filter(Boolean))],
              })
            }
          />
        </Row>
        {errFor('tags')}
        <Row label="Estimate" htmlFor={ids.estimate}>
          <select
            id={ids.estimate}
            className={inputCls}
            value={t.estimateMinutes ?? ''}
            disabled={deleted}
            onChange={(e) => void save('estimateMinutes', { estimateMinutes: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">No estimate</option>
            {[5, 15, 30, 45, 60, 90, 120, 180, 240, 480].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
            {t.estimateMinutes && ![5, 15, 30, 45, 60, 90, 120, 180, 240, 480].includes(t.estimateMinutes) && (
              <option value={t.estimateMinutes}>{t.estimateMinutes} min</option>
            )}
          </select>
        </Row>
        <Row label="Repeat" htmlFor={ids.repeat}>
          <RepeatField
            key={`${t.id}-${t.version}-rep`}
            id={ids.repeat}
            preset={preset}
            rule={t.recurrenceRule}
            disabled={deleted}
            onSave={(recurrenceRule) => save('recurrenceRule', { recurrenceRule })}
          />
        </Row>
        {t.recurrenceText && (
          <p className="-mt-1 text-meta text-subtle-foreground sm:pl-[124px]">
            <Repeat aria-hidden className="mr-1 inline size-3.5" />
            {t.recurrenceText}
          </p>
        )}
        {errFor('recurrenceRule')}
        <Row label="Snooze">
          {snoozed ? (
            <>
              <span className="text-body text-foreground">Until {new Date(t.snoozedUntil!).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              <button type="button" className={ghostBtn} onClick={() => void runAndReload('clear the snooze', () => tasksApi.action(t.id, { action: 'snooze', until: null, version: t.version }))}>
                Clear
              </button>
            </>
          ) : (
            <div className="flex flex-wrap gap-1">
              {[
                { label: 'Tomorrow', until: { date: addDays(today, 1), time: '09:00' } },
                { label: 'Next week', until: { date: addDays(today, 7), time: '09:00' } },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  disabled={deleted || closed}
                  className={cn(ghostBtn, 'border border-border')}
                  onClick={() =>
                    void runAndReload('snooze the task', async () => {
                      await tasksApi.action(t.id, { action: 'snooze', until: o.until, version: t.version });
                      notify({ title: `Snoozed until ${dueText(o.until, today)}`, tone: 'success' });
                    })
                  }
                >
                  <AlarmClock aria-hidden className="size-3.5" />
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </Row>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.notes} className="text-body-sm text-muted-foreground">
          Notes
        </label>
        <NotesField key={`${t.id}-${t.version}-notes`} id={ids.notes} value={t.description ?? ''} disabled={deleted} onSave={(v) => save('description', { description: v.trim() ? v : null })} />
      </div>

      <Section
        title="Subtasks"
        icon={Check}
        action={
          detail.subtaskProgress.total > 0 ? (
            <span className="tabular text-meta text-subtle-foreground">
              {detail.subtaskProgress.done} of {detail.subtaskProgress.total} done
            </span>
          ) : null
        }
      >
        <ul className="flex flex-col">
          {detail.subtasks.map((s) => (
            <SubtaskRow key={s.id} task={s} onToggle={() => void runAndReload('update the subtask', () => tasksApi.action(s.id, { action: s.status === 'DONE' ? 'reopen' : 'complete' }))} onOpen={() => app?.openTask(s.id)} />
          ))}
        </ul>
        {!deleted && <AddSubtask parentId={t.id} projectId={t.projectId} onAdded={() => void load().then(() => router.refresh())} />}
      </Section>

      <Section title="Dependencies" icon={Link2}>
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-meta text-subtle-foreground">Waiting on</p>
            {detail.dependsOn.length === 0 ? (
              <p className="text-body-sm text-subtle-foreground">Nothing — this task can start any time.</p>
            ) : (
              <ul className="flex flex-col">
                {detail.dependsOn.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-1">
                    <span className={cn('size-2 shrink-0 rounded-full', detail.openBlockerIds.includes(d.id) ? 'bg-warning' : 'bg-success')} aria-hidden />
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-body hover:underline" onClick={() => app?.openTask(d.id)}>
                      {d.title}
                      <span className="sr-only">{detail.openBlockerIds.includes(d.id) ? ' (open)' : ' (done)'}</span>
                    </button>
                    <button
                      type="button"
                      className="grid size-7 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2 hover:text-foreground"
                      aria-label={`Remove dependency on ${d.title}`}
                      onClick={() => void runAndReload('remove the dependency', () => tasksApi.removeDependency(t.id, d.id))}
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!deleted && <AddDependency taskId={t.id} exclude={[t.id, ...detail.dependsOn.map((d) => d.id)]} onAdd={(depId) => runAndReload('add the dependency', () => tasksApi.addDependency(t.id, depId))} />}
          </div>
          {detail.blocks.length > 0 && (
            <div>
              <p className="mb-1 text-meta text-subtle-foreground">Blocking</p>
              <ul className="flex flex-col">
                {detail.blocks.map((b) => (
                  <li key={b.id} className="py-1">
                    <button type="button" className="truncate text-left text-body hover:underline" onClick={() => app?.openTask(b.id)}>
                      {b.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section title="Reminders" icon={Bell}>
        {detail.reminders.length === 0 ? (
          <p className="text-body-sm text-subtle-foreground">No reminders.</p>
        ) : (
          <ul className="flex flex-col">
            {detail.reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-1">
                <span className="flex-1 text-body text-foreground">
                  {dueText(r.local, today)}
                  {r.status !== 'PENDING' && <span className="ml-2 text-meta text-subtle-foreground">{r.status.toLowerCase()}</span>}
                </span>
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2 hover:text-foreground"
                  aria-label={`Remove reminder ${dueText(r.local, today)}`}
                  onClick={() => void runAndReload('remove the reminder', () => tasksApi.removeReminder(t.id, r.id))}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!deleted && !closed && <AddReminder today={today} due={t.due} onAdd={(at) => runAndReload('add the reminder', () => tasksApi.addReminder(t.id, at))} />}
      </Section>

      <Section title="History" icon={History}>
        {!events ? (
          <p className="text-body-sm text-subtle-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-body-sm text-subtle-foreground">No changes yet.</p>
        ) : (
          <ol className="flex flex-col">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-1">
                <span className={cn('min-w-0 flex-1 truncate text-body-sm', e.undone ? 'text-subtle-foreground line-through' : 'text-foreground')}>
                  {describeEvent(e)}
                  {actorOf(e) && <span className="text-subtle-foreground"> {actorOf(e)}</span>}
                  {e.undone && <span className="sr-only"> (undone)</span>}
                </span>
                <time dateTime={e.createdAt} className="tabular shrink-0 text-meta text-subtle-foreground">
                  {relativeTime(e.createdAt)}
                </time>
                {!e.undone && !NOT_UNDOABLE.has(e.type) && (
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-meta text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                    aria-label={`Undo: ${describeEvent(e)}`}
                    onClick={() =>
                      void runAndReload('undo that change', async () => {
                        await tasksApi.undo(e.batchId ? { batchId: e.batchId } : { eventId: e.id }, 'history');
                        notify({ title: 'Undone', tone: 'success' });
                      })
                    }
                  >
                    <Undo2 aria-hidden className="size-3.5" />
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {!deleted && (
        <div className="flex justify-between border-t border-border pt-4">
          {!closed ? (
            <button type="button" className={ghostBtn} onClick={() => void runAndReload('cancel the task', () => tasksApi.action(t.id, { action: 'cancel', version: t.version }))}>
              Won&rsquo;t do
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className={cn(ghostBtn, 'text-danger hover:bg-danger-subtle hover:text-danger')}
            onClick={async () => {
              if (await actions.remove(t)) onDeleted?.();
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            Delete
          </button>
        </div>
      )}
      {saving && (
        <span className="sr-only" role="status">
          Saving…
        </span>
      )}
    </div>
  );
}

// ── field editors ────────────────────────────────────────────────────────────

function TitleField({ id, titleId, value, closed, onSave }: { id: string; titleId?: string; value: string; closed: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const commit = () => {
    const next = v.trim();
    if (!next) setV(value);
    else if (next !== value) onSave(next);
  };
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} id={titleId} className="sr-only">
        {value}
      </label>
      <textarea
        id={id}
        rows={1}
        value={v}
        maxLength={500}
        onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === 'Escape' && v !== value) {
            e.stopPropagation();
            setV(value);
          }
        }}
        className={cn(
          'field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-heading text-foreground hover:border-border focus-visible:border-ring focus-visible:outline-none',
          closed && 'text-muted-foreground line-through',
        )}
      />
    </div>
  );
}

function TextCommit({ id, value, placeholder, disabled, onSave }: { id: string; value: string; placeholder?: string; disabled?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      id={id}
      className={inputCls}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape' && v !== value) {
          e.stopPropagation();
          setV(value);
        }
      }}
    />
  );
}

function NotesField({ id, value, disabled, onSave }: { id: string; value: string; disabled?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <textarea
      id={id}
      value={v}
      disabled={disabled}
      rows={3}
      maxLength={20_000}
      placeholder="Add notes"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      className={cn(inputCls, 'field-sizing-content h-auto min-h-20 resize-y py-1.5')}
    />
  );
}

function DueField({ dateId, timeId, value, disabled, onSave }: { dateId: string; timeId: string; value: LocalDateTime | null; disabled?: boolean; onSave: (v: LocalDateTime | null) => void }) {
  const [date, setDate] = useState(value?.date ?? '');
  const [time, setTime] = useState(value?.time ?? '');
  const commit = (d: string, tm: string) => {
    const next = d ? { date: d, time: tm || null } : null;
    if (JSON.stringify(next) !== JSON.stringify(value)) onSave(next);
  };
  return (
    <>
      <input
        id={dateId}
        type="date"
        className={cn(inputCls, 'min-w-[9.5rem] flex-1')}
        value={date}
        disabled={disabled}
        onChange={(e) => setDate(e.target.value)}
        onBlur={() => commit(date, time)}
      />
      <label htmlFor={timeId} className="sr-only">
        Due time
      </label>
      <input
        id={timeId}
        type="time"
        className={cn(inputCls, 'w-[7.5rem] shrink-0')}
        value={time}
        disabled={disabled || !date}
        onChange={(e) => setTime(e.target.value)}
        onBlur={() => commit(date, time)}
      />
      {value && (
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2 hover:text-foreground"
          aria-label="Clear due date"
          disabled={disabled}
          onClick={() => {
            setDate('');
            setTime('');
            onSave(null);
          }}
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </>
  );
}

function RepeatField({ id, preset, rule, disabled, onSave }: { id: string; preset: string; rule: string | null; disabled?: boolean; onSave: (v: string | null) => void }) {
  const [mode, setMode] = useState(preset);
  const [custom, setCustom] = useState(preset === 'custom' ? (rule ?? '') : '');
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <select
        id={id}
        className={inputCls}
        value={mode}
        disabled={disabled}
        onChange={(e) => {
          setMode(e.target.value);
          if (e.target.value !== 'custom') onSave(e.target.value || null);
        }}
      >
        {REPEAT_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom rule…</option>
      </select>
      {mode === 'custom' && (
        <input
          aria-label="Custom repeat rule (RRULE)"
          className={cn(inputCls, 'font-mono text-meta')}
          placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => custom.trim() && custom.trim() !== rule && onSave(custom.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </div>
  );
}

function SubtaskRow({ task, onToggle, onOpen }: { task: TaskDTO; onToggle: () => void; onOpen: () => void }) {
  const done = task.status === 'DONE';
  return (
    <li className="flex items-center gap-2 py-0.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={onToggle}
        className="grid size-6 shrink-0 place-items-center rounded-full"
      >
        <span className={cn('grid size-4 place-items-center rounded-full border', done ? 'border-success bg-success text-background' : 'border-border-strong')}>
          {done && <Check aria-hidden className="size-3" strokeWidth={3} />}
        </span>
      </button>
      <button type="button" onClick={onOpen} className={cn('min-w-0 flex-1 truncate text-left text-body hover:underline', done && 'text-subtle-foreground line-through')}>
        {task.title}
      </button>
    </li>
  );
}

function AddSubtask({ parentId, projectId, onAdded }: { parentId: string; projectId: string | null; onAdded: () => void }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const title = v.trim();
    if (!title) return;
    setBusy(true);
    try {
      await tasksApi.create({ title, parentId, projectId, status: 'TODO' });
      setV('');
      onAdded();
    } catch (e) {
      notify({ title: "Couldn't add the subtask", description: e instanceof ApiError ? e.message : undefined, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-1 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Plus aria-hidden className="ml-1 size-4 shrink-0 text-subtle-foreground" />
      <input aria-label="Add a subtask" placeholder="Add a subtask" className={cn(inputCls, 'border-transparent bg-transparent')} value={v} onChange={(e) => setV(e.target.value)} disabled={busy} maxLength={500} />
    </form>
  );
}

function AddDependency({ taskId, exclude, onAdd }: { taskId: string; exclude: string[]; onAdd: (id: string) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TaskDTO[]>([]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      tasksApi
        .list({ q: term, limit: 8 })
        .then((r) => setResults(r.items.map((i) => i.task).filter((x) => !exclude.includes(x.id) && x.id !== taskId)))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
    // exclude is derived from props each render; the search term drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, taskId]);
  return (
    <div className="relative mt-1">
      <input
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Add a task this one waits on"
        placeholder="Waits on… (search tasks)"
        className={cn(inputCls, 'border-transparent bg-transparent')}
        value={q}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-9 z-10 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-popover">
          {results.map((r) => (
            <li
              key={r.id}
              role="option"
              aria-selected={false}
              tabIndex={-1}
              className="cursor-pointer truncate rounded px-2 py-1.5 text-body hover:bg-surface-2"
              onMouseDown={(e) => e.preventDefault()}
              onClick={async () => {
                setQ('');
                setResults([]);
                await onAdd(r.id);
              }}
            >
              {r.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddReminder({ today, due, onAdd }: { today: string; due: LocalDateTime | null; onAdd: (at: LocalDateTime) => Promise<void> }) {
  const [date, setDate] = useState(due?.date ?? today);
  const [time, setTime] = useState(due?.time ?? '09:00');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onAdd({ date, time });
        setBusy(false);
      }}
    >
      <input aria-label="Reminder date" type="date" className={cn(inputCls, 'min-w-[9.5rem] flex-1')} value={date} min={today} onChange={(e) => setDate(e.target.value)} required />
      <input aria-label="Reminder time" type="time" className={cn(inputCls, 'w-28')} value={time} onChange={(e) => setTime(e.target.value)} required />
      <button type="submit" disabled={busy} className={cn(ghostBtn, 'border border-border')}>
        {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Bell aria-hidden className="size-4" />}
        Add reminder
      </button>
    </form>
  );
}
