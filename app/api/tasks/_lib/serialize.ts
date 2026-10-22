// app/api/tasks/_lib/serialize.ts — Prisma rows → browser DTOs
// (components/tasks/types.ts). Local dates are computed here, in the user's
// zone, so the client never does time-zone arithmetic.
import { z } from 'zod';
import type { Reminder, Task, TaskEvent } from '@/lib/tasks/repo';
import type { ProjectWithCounts, Project } from '@/lib/projects/repo';
import { describeRRule } from '@/lib/tasks/recurrence';
import {
  atLocalTime,
  floatingDate,
  floatingToLocalDate,
  isLocalDate,
  localDateOf,
  zonedParts,
  type LocalDate,
} from '@/lib/time';
import type { LocalDateTime, ProjectDTO, ReminderDTO, TaskDTO, TaskEventDTO } from '@/components/tasks/types';

const OPEN = new Set(['INBOX', 'TODO', 'IN_PROGRESS']);
const pad = (n: number) => String(n).padStart(2, '0');

function wallTime(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function localOf(instant: Date, timeZone: string): LocalDateTime {
  return { date: localDateOf(instant, timeZone), time: wallTime(instant, timeZone) };
}

function dueOf(task: Task, timeZone: string): LocalDateTime | null {
  if (!task.dueAt) return null;
  if (!task.dueHasTime) return { date: floatingToLocalDate(task.dueAt), time: null };
  return localOf(task.dueAt, timeZone);
}

function safeDescribe(rule: string | null): string | null {
  if (!rule) return null;
  try {
    return describeRRule(rule);
  } catch {
    return 'Repeats';
  }
}

export interface Clock {
  timeZone: string;
  today: LocalDate;
  now: Date;
}

export function clockFor(timeZone: string, now: Date = new Date()): Clock {
  return { timeZone, today: localDateOf(now, timeZone), now };
}

export function toTaskDTO(task: Task, clock: Clock): TaskDTO {
  const due = dueOf(task, clock.timeZone);
  const open = OPEN.has(task.status);
  const isOverdue = Boolean(
    open && task.dueAt && (task.dueHasTime ? task.dueAt.getTime() < clock.now.getTime() : due!.date < clock.today),
  );
  const isDueToday = Boolean(due && due.date === clock.today);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    dueHasTime: task.dueHasTime,
    due,
    start: task.startAt ? localOf(task.startAt, clock.timeZone) : null,
    estimateMinutes: task.estimateMinutes,
    projectId: task.projectId,
    parentId: task.parentId,
    tags: task.tags,
    recurrenceRule: task.recurrenceRule,
    recurrenceText: safeDescribe(task.recurrenceRule),
    snoozedUntil: task.snoozedUntil?.toISOString() ?? null,
    source: task.source,
    sourceRef: task.sourceRef,
    completedAt: task.completedAt?.toISOString() ?? null,
    deletedAt: task.deletedAt?.toISOString() ?? null,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    isOverdue,
    isDueToday,
  };
}

export function toReminderDTO(r: Reminder, clock: Clock): ReminderDTO {
  return { id: r.id, remindAt: r.remindAt.toISOString(), local: localOf(r.remindAt, clock.timeZone), status: r.status, channel: r.channel };
}

export function toEventDTO(e: TaskEvent, undoneIds: Set<string>): TaskEventDTO {
  return {
    id: e.id,
    type: e.type,
    actorType: e.actorType,
    source: e.source,
    before: (e.before as Record<string, unknown> | null) ?? null,
    after: (e.after as Record<string, unknown> | null) ?? null,
    createdAt: e.createdAt.toISOString(),
    batchId: e.batchId,
    undone: undoneIds.has(e.id),
  };
}

export function toProjectDTO(p: Project | ProjectWithCounts): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    openTaskCount: 'openTaskCount' in p ? p.openTaskCount : 0,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    version: p.version,
  };
}

// ───────────────────────── input: local date/time ─────────────────────────

export const LocalDateSchema = z.string().refine(isLocalDate, 'Use YYYY-MM-DD');
export const HHmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

/** `{ date, time? }` in the user's zone. Without a time it is a date-only value. */
export const LocalDateTimeInput = z.object({ date: LocalDateSchema, time: HHmmSchema.nullish() }).strict();
export type LocalDateTimeInput = z.infer<typeof LocalDateTimeInput>;

/** Due date input → repo fields (date-only deadlines are floating dates, docs/03 §1). */
export function dueFields(input: LocalDateTimeInput | null, timeZone: string): { dueAt: Date | null; dueHasTime: boolean } {
  if (!input) return { dueAt: null, dueHasTime: false };
  if (!input.time) return { dueAt: floatingDate(input.date), dueHasTime: false };
  return { dueAt: atLocalTime(input.date, input.time, timeZone), dueHasTime: true };
}

/** An instant from a local date + time (start, reminders, snooze). Date-only means 09:00. */
export function instantOf(input: LocalDateTimeInput, timeZone: string, defaultTime = '09:00'): Date {
  return atLocalTime(input.date, input.time ?? defaultTime, timeZone);
}
