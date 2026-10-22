// lib/tasks/repo/views.ts — task views (FR-202) with keyset pagination.
//
// A view is a list of segments (e.g. Today = [overdue, today]); each segment
// is a `where` plus a total order ending in `id`. The cursor records the
// segment and the sort-key values of the last row returned, so pages are
// stable under inserts and never skip or repeat rows.
import { NotFoundError, ValidationError } from '@/lib/db/errors';
import { type Tx, reader } from '@/lib/db/tx';
import type { Prisma } from '@/lib/generated/prisma/client';
import { addDays, floatingDate, floatingToLocalDate, localDateOf, startOfLocalDay } from '@/lib/time';
import type { ListOptions, Task, TaskFilter, TaskListItem, TaskPage, TaskSort, TaskViewSpec } from '../types';
import { OPEN_STATUSES } from '../types';
import { normalizeTag } from '../validation';
import { userTimeZone } from './internal';

type SortField = 'dueAt' | 'priority' | 'createdAt' | 'updatedAt' | 'completedAt' | 'deletedAt' | 'title' | 'dueHasTime' | 'startAt';
interface SortKey {
  field: SortField;
  dir: 'asc' | 'desc';
}
const NULLABLE = new Set<SortField>(['dueAt', 'completedAt', 'deletedAt', 'startAt']);
const DATE_SORT = new Set<SortField>(['dueAt', 'createdAt', 'updatedAt', 'completedAt', 'deletedAt', 'startAt']);

interface Segment {
  where: Prisma.TaskWhereInput;
  sort: SortKey[];
  group: (task: Task) => string | null;
}

interface Cursor {
  s: number; // segment index
  v: (string | number | boolean | null)[]; // sort-key values of the last row
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.s !== 'number' || !Array.isArray(c.v) || typeof c.id !== 'string') throw new Error('shape');
    return c;
  } catch {
    throw new ValidationError('INVALID_CURSOR', 'Invalid pagination cursor', 'cursor');
  }
}

// ───────────────────────── keyset ─────────────────────────

function orderBy(sort: SortKey[]): Prisma.TaskOrderByWithRelationInput[] {
  return [
    ...sort.map((k) =>
      NULLABLE.has(k.field) ? { [k.field]: { sort: k.dir, nulls: 'last' } } : { [k.field]: k.dir },
    ),
    { id: 'asc' },
  ] as Prisma.TaskOrderByWithRelationInput[];
}

function keyValue(task: Task, field: SortField): string | number | boolean | null {
  const v = task[field] as unknown;
  if (v instanceof Date) return v.toISOString();
  return (v ?? null) as string | number | boolean | null;
}

function decodeValue(field: SortField, v: string | number | boolean | null): unknown {
  return v !== null && DATE_SORT.has(field) ? new Date(v as string) : v;
}

/** Rows strictly after `v` on one key (nulls sort last in both directions). */
function afterKey(k: SortKey, raw: string | number | boolean | null): Prisma.TaskWhereInput | null {
  if (raw === null) return null; // nothing sorts after a null except id ties
  if (typeof raw === 'boolean') {
    // Prisma boolean filters have no lt/gt: false < true.
    const next = k.dir === 'asc' ? (raw ? null : true) : raw ? false : null;
    return next === null ? null : ({ [k.field]: next } as Prisma.TaskWhereInput);
  }
  const v = decodeValue(k.field, raw);
  const cmp = { [k.field]: { [k.dir === 'asc' ? 'gt' : 'lt']: v } } as Prisma.TaskWhereInput;
  return NULLABLE.has(k.field) ? { OR: [cmp, { [k.field]: null } as Prisma.TaskWhereInput] } : cmp;
}

function equalKey(k: SortKey, raw: string | number | boolean | null): Prisma.TaskWhereInput {
  return { [k.field]: raw === null ? null : decodeValue(k.field, raw) } as Prisma.TaskWhereInput;
}

function keysetWhere(sort: SortKey[], c: Cursor): Prisma.TaskWhereInput {
  const ors: Prisma.TaskWhereInput[] = [];
  for (let i = 0; i < sort.length; i++) {
    const after = afterKey(sort[i], c.v[i]);
    if (!after) continue;
    ors.push({ AND: [...sort.slice(0, i).map((k, j) => equalKey(k, c.v[j])), after] });
  }
  ors.push({ AND: [...sort.map((k, j) => equalKey(k, c.v[j])), { id: { gt: c.id } }] });
  return { OR: ors };
}

// ───────────────────────── filters ─────────────────────────

export function filterWhere(filter: TaskFilter = {}): Prisma.TaskWhereInput[] {
  const and: Prisma.TaskWhereInput[] = [];
  if (filter.status?.length) and.push({ status: { in: filter.status } });
  if (filter.priority?.length) and.push({ priority: { in: filter.priority } });
  if (filter.minPriority !== undefined) and.push({ priority: { gte: filter.minPriority } });
  if (filter.projectId !== undefined) and.push({ projectId: filter.projectId });
  if (filter.tags?.length) and.push({ tags: { hasEvery: filter.tags.map(normalizeTag) } });
  if (filter.anyTags?.length) and.push({ tags: { hasSome: filter.anyTags.map(normalizeTag) } });
  if (filter.dueFrom) and.push({ dueAt: { gte: filter.dueFrom } });
  if (filter.dueTo) and.push({ dueAt: { lt: filter.dueTo } });
  if (filter.dueOn) {
    const { from, toExclusive, timeZone } = filter.dueOn;
    and.push({
      OR: [
        { dueHasTime: true, dueAt: { gte: startOfLocalDay(from, timeZone), lt: startOfLocalDay(toExclusive, timeZone) } },
        { dueHasTime: false, dueAt: { gte: floatingDate(from), lt: floatingDate(toExclusive) } },
      ],
    });
  }
  if (filter.hasDue !== undefined) and.push({ dueAt: filter.hasDue ? { not: null } : null });
  if (filter.createdFrom) and.push({ createdAt: { gte: filter.createdFrom } });
  if (filter.createdTo) and.push({ createdAt: { lt: filter.createdTo } });
  if (filter.completedFrom) and.push({ completedAt: { gte: filter.completedFrom } });
  if (filter.completedTo) and.push({ completedAt: { lt: filter.completedTo } });
  if (filter.source?.length) and.push({ source: { in: filter.source } });
  if (filter.sourceRef !== undefined) and.push({ sourceRef: filter.sourceRef });
  if (filter.parentId !== undefined) and.push({ parentId: filter.parentId });
  if (filter.recurrenceSeriesId) and.push({ recurrenceSeriesId: filter.recurrenceSeriesId });
  return and;
}

// ───────────────────────── view definitions ─────────────────────────

interface Clock {
  timeZone: string;
  now: Date;
  today: string;
  todayStart: Date;
  tomorrowStart: Date;
}

function clock(timeZone: string, now: Date): Clock {
  const today = localDateOf(now, timeZone);
  return { timeZone, now, today, todayStart: startOfLocalDay(today, timeZone), tomorrowStart: startOfLocalDay(addDays(today, 1), timeZone) };
}

const openWhere: Prisma.TaskWhereInput = { status: { in: [...OPEN_STATUSES] } };
const notSnoozed = (now: Date): Prisma.TaskWhereInput => ({ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] });

/** Due before today (timed: before local midnight; date-only: an earlier calendar date). */
export function overdueWhere(c: Clock): Prisma.TaskWhereInput {
  return {
    OR: [
      { dueHasTime: true, dueAt: { lt: c.todayStart } },
      { dueHasTime: false, dueAt: { lt: floatingDate(c.today) } },
    ],
  };
}

export function dueTodayWhere(c: Clock): Prisma.TaskWhereInput {
  return {
    OR: [
      { dueHasTime: true, dueAt: { gte: c.todayStart, lt: c.tomorrowStart } },
      { dueHasTime: false, dueAt: floatingDate(c.today) },
      { startAt: { gte: c.todayStart, lt: c.tomorrowStart } },
    ],
  };
}

function dueLocalDate(task: Task, timeZone: string): string | null {
  if (!task.dueAt) return null;
  return task.dueHasTime ? localDateOf(task.dueAt, timeZone) : floatingToLocalDate(task.dueAt);
}

function sortFor(sort: TaskSort | undefined, fallback: SortKey[]): SortKey[] {
  switch (sort) {
    case 'due':
      return [{ field: 'dueAt', dir: 'asc' }, { field: 'priority', dir: 'desc' }];
    case 'priority':
      return [{ field: 'priority', dir: 'desc' }, { field: 'dueAt', dir: 'asc' }];
    case 'created':
      return [{ field: 'createdAt', dir: 'desc' }];
    case 'updated':
      return [{ field: 'updatedAt', dir: 'desc' }];
    case 'title':
      return [{ field: 'title', dir: 'asc' }];
    default:
      return fallback;
  }
}

async function segmentsFor(tx: Tx, userId: string, view: TaskViewSpec, c: Clock, opts: ListOptions): Promise<Segment[]> {
  const live: Prisma.TaskWhereInput = { userId, deletedAt: null, ...(opts.filter?.includeArchived ? {} : { archivedAt: null }) };
  const none = () => null;
  switch (view.kind) {
    case 'today': {
      // FR-204: overdue first, then priority, then timed tasks by time.
      const order = sortFor(opts.sort, [
        { field: 'priority', dir: 'desc' },
        { field: 'dueHasTime', dir: 'desc' },
        { field: 'dueAt', dir: 'asc' },
      ]);
      const base = { AND: [live, openWhere, notSnoozed(c.now)] };
      // (`NOT overdue` alone would drop dueAt-null rows: SQL NOT of NULL is NULL.)
      return [
        { where: { AND: [base, overdueWhere(c)] }, sort: order, group: () => 'overdue' },
        { where: { AND: [base, dueTodayWhere(c), { OR: [{ dueAt: null }, { NOT: overdueWhere(c) }] }] }, sort: order, group: () => 'today' },
      ];
    }
    case 'upcoming': {
      const days = Math.min(Math.max(view.days ?? 14, 1), 60);
      const horizon = addDays(c.today, days);
      return [
        {
          where: {
            AND: [
              live,
              openWhere,
              { OR: [{ dueHasTime: true, dueAt: { gte: c.tomorrowStart } }, { dueHasTime: false, dueAt: { gte: floatingDate(addDays(c.today, 1)) } }] },
            ],
          },
          sort: sortFor(opts.sort, [{ field: 'dueAt', dir: 'asc' }, { field: 'priority', dir: 'desc' }]),
          group: (t) => {
            const d = dueLocalDate(t, c.timeZone);
            return d && d <= horizon ? d : 'later';
          },
        },
      ];
    }
    case 'inbox':
      return [{ where: { AND: [live, { status: 'INBOX' }, notSnoozed(c.now)] }, sort: sortFor(opts.sort, [{ field: 'createdAt', dir: 'desc' }]), group: none }];
    case 'overdue':
      return [
        {
          where: { AND: [live, openWhere, notSnoozed(c.now), overdueWhere(c)] },
          sort: sortFor(opts.sort, [{ field: 'dueAt', dir: 'asc' }, { field: 'priority', dir: 'desc' }]),
          group: none,
        },
      ];
    case 'completed':
      return [
        {
          where: { AND: [{ userId, deletedAt: null }, { status: 'DONE' }] },
          sort: [{ field: 'completedAt', dir: 'desc' }],
          group: (t) => (t.completedAt ? localDateOf(t.completedAt, c.timeZone) : null),
        },
      ];
    case 'all':
      return [{ where: live, sort: sortFor(opts.sort, [{ field: 'createdAt', dir: 'desc' }]), group: none }];
    case 'trash':
      return [{ where: { userId, deletedAt: { not: null } }, sort: [{ field: 'deletedAt', dir: 'desc' }], group: none }];
    case 'project': {
      if (!view.projectId) throw new ValidationError('PROJECT_REQUIRED', 'projectId is required for the project view', 'projectId');
      const project = await tx.project.findFirst({ where: { id: view.projectId, userId, deletedAt: null }, select: { id: true } });
      if (!project) throw new NotFoundError('Project', view.projectId);
      const order = sortFor(opts.sort, [{ field: 'priority', dir: 'desc' }, { field: 'dueAt', dir: 'asc' }]);
      return (['IN_PROGRESS', 'TODO', 'INBOX', 'DONE', 'CANCELLED'] as const).map((status) => ({
        where: { AND: [live, { projectId: view.projectId, status }] },
        sort: order,
        group: () => status,
      }));
    }
  }
}

/** Lists a task view for `userId`, paginated by an opaque cursor. */
export async function listTasks(userId: string, view: TaskViewSpec, opts: ListOptions = {}): Promise<TaskPage> {
  const tx = reader(opts.tx);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const timeZone = opts.timeZone ?? (await userTimeZone(tx, userId));
  const c = clock(timeZone, opts.now ?? new Date());
  const segments = await segmentsFor(tx, userId, view, c, opts);
  const extra = filterWhere(opts.filter);
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;

  const items: TaskListItem[] = [];
  for (let s = cursor?.s ?? 0; s < segments.length && items.length <= limit; s++) {
    const seg = segments[s];
    const and: Prisma.TaskWhereInput[] = [seg.where, ...extra];
    if (cursor && s === cursor.s) and.push(keysetWhere(seg.sort, cursor));
    const rows = await tx.task.findMany({ where: { AND: and }, orderBy: orderBy(seg.sort), take: limit + 1 - items.length });
    for (const task of rows) items.push({ task, group: seg.group(task), ...{ _s: s } } as TaskListItem & { _s: number });
  }

  let nextCursor: string | null = null;
  if (items.length > limit) {
    items.length = limit;
    const last = items[limit - 1] as TaskListItem & { _s: number };
    const seg = segments[last._s];
    nextCursor = encodeCursor({ s: last._s, v: seg.sort.map((k) => keyValue(last.task, k.field)), id: last.task.id });
  }
  return { items: items.map(({ task, group }) => ({ task, group })), nextCursor };
}
