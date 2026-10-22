'use client';
// components/tasks/task-row.tsx — one task (docs/07 §9 "Task row"):
// select · complete · title · chips (project, tags) · meta (due, repeat, snooze) · priority.
import { forwardRef } from 'react';
import { m } from 'motion/react';
import { AlarmClock, Check, Folder, Repeat } from 'lucide-react';
import { cn } from '@/components/app/cn';
import { DueMeta, PriorityGlyph } from './format';
import type { TaskDTO } from './types';

export interface TaskRowProps {
  task: TaskDTO;
  today: string;
  projectName: string | null;
  active: boolean;
  selected: boolean;
  selectionMode: boolean;
  onFocusRow: () => void;
  onToggleComplete: () => void;
  onToggleSelect: (range: boolean) => void;
  onOpen: () => void;
}

export const TaskRow = forwardRef<HTMLLIElement, TaskRowProps>(function TaskRow(
  { task, today, projectName, active, selected, selectionMode, onFocusRow, onToggleComplete, onToggleSelect, onOpen },
  ref,
) {
  const done = task.status === 'DONE';
  const cancelled = task.status === 'CANCELLED';
  const closed = done || cancelled;
  const snoozed = task.snoozedUntil && new Date(task.snoozedUntil).getTime() > Date.now();
  return (
    <m.li
      ref={ref}
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      tabIndex={active ? 0 : -1}
      data-task-id={task.id}
      data-active={active || undefined}
      aria-label={`${task.title}${done ? ', completed' : ''}${task.isOverdue ? ', overdue' : ''}${selected ? ', selected' : ''}`}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusRow();
      }}
      onClick={(e) => {
        if (e.shiftKey) {
          e.preventDefault();
          onToggleSelect(true);
        }
      }}
      className={cn(
        'group/row relative flex min-h-9 items-center gap-2 rounded-md px-2 py-1 outline-none',
        'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        selected && 'bg-brand-subtle hover:bg-brand-subtle',
        active && 'group-focus-within/list:before:absolute group-focus-within/list:before:inset-y-1.5 group-focus-within/list:before:left-0 group-focus-within/list:before:w-0.5 group-focus-within/list:before:rounded-full group-focus-within/list:before:bg-brand',
      )}
    >
      <input
        type="checkbox"
        tabIndex={-1}
        checked={selected}
        onChange={(e) => onToggleSelect((e.nativeEvent as MouseEvent).shiftKey)}
        aria-label={`Select ${task.title}`}
        className={cn(
          'size-4 shrink-0 cursor-pointer rounded-sm accent-[var(--brand)]',
          selectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={onToggleComplete}
        className="grid size-6 shrink-0 place-items-center rounded-full"
      >
        <span
          className={cn(
            'grid size-4 place-items-center rounded-full border transition-colors duration-80',
            done ? 'border-success bg-success text-background' : 'border-border-strong hover:border-foreground',
            task.priority >= 4 && !done && 'border-priority-urgent',
          )}
        >
          {done && <Check aria-hidden className="size-3" strokeWidth={3} />}
        </span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-1 text-left sm:flex-row sm:items-center sm:gap-2"
      >
        <span
          className={cn(
            'max-w-full truncate text-body text-foreground transition-colors duration-180',
            closed && 'text-subtle-foreground line-through',
          )}
          title={task.title}
        >
          {task.title}
        </span>
        <span className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 sm:ml-auto">
          {projectName && (
            <span className="inline-flex max-w-32 items-center gap-1 truncate text-meta text-subtle-foreground">
              <Folder aria-hidden className="size-3.5" />
              {projectName}
            </span>
          )}
          {task.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-sm bg-surface-2 px-1 text-meta text-muted-foreground">
              #{t}
            </span>
          ))}
          {task.recurrenceText && (
            <span className="inline-flex items-center text-subtle-foreground" title={task.recurrenceText}>
              <Repeat aria-hidden className="size-3.5" />
              <span className="sr-only">{task.recurrenceText}</span>
            </span>
          )}
          {snoozed && (
            <span className="inline-flex items-center gap-1 text-meta text-subtle-foreground">
              <AlarmClock aria-hidden className="size-3.5" /> Snoozed
            </span>
          )}
          {task.due && <DueMeta due={task.due} today={today} overdue={task.isOverdue} done={closed} />}
        </span>
      </button>
      <span className="flex w-5 shrink-0 justify-center">
        <PriorityGlyph priority={task.priority} />
      </span>
    </m.li>
  );
});
