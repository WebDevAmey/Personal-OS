// lib/tasks/repo/search.ts — full-text search (FR-203) and the duplicate
// title hint (FR-214). Raw SQL is always scoped by "userId".
import { ValidationError } from '@/lib/db/errors';
import { type Tx, reader } from '@/lib/db/tx';
import { Prisma, type TaskStatus } from '@/lib/generated/prisma/client';
import { addDays, isLocalDate, localDateOf } from '@/lib/time';
import type { SearchOptions, SimilarTask, Task, TaskFilter, TaskPage } from '../types';
import { OPEN_STATUSES, PRIORITY } from '../types';
import { SQL_NORMALIZED_TITLE, normalizeForSimilarity } from '../validation';
import { userTimeZone } from './internal';
import { filterWhere, listTasks } from './views';

const SEARCH_VECTOR = Prisma.raw(`to_tsvector('simple'::regconfig, coalesce("title", '') || ' ' || coalesce("description", ''))`);
const MAX_CANDIDATES = 500;

/** Words → prefix tsquery "w1:* & w2:*" (only letters/digits survive, so it is injection-safe). */
export function toPrefixQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/**
 * Open tasks whose normalised title is trigram-similar (pg_trgm) to `title`.
 * Never blocks creation; used as a hint.
 */
export async function findSimilarTasks(
  userId: string,
  title: string,
  opts: { threshold?: number; limit?: number; excludeId?: string; tx?: Tx } = {},
): Promise<SimilarTask[]> {
  const normalized = normalizeForSimilarity(title);
  if (!normalized) return [];
  const threshold = opts.threshold ?? 0.8;
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 20);
  const norm = Prisma.raw(SQL_NORMALIZED_TITLE);
  const rows = await reader(opts.tx).$queryRaw<SimilarTask[]>`
    SELECT "id", "title", "dueAt", "dueHasTime", similarity(${norm}, ${normalized})::float8 AS "score"
    FROM "Task"
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND "status" IN ('INBOX', 'TODO', 'IN_PROGRESS')
      AND "id" <> ${opts.excludeId ?? ''}
      AND similarity(${norm}, ${normalized}) >= ${threshold}
    ORDER BY "score" DESC, "id"
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

interface Ranked {
  id: string;
  rank: number;
}

interface OffsetCursor {
  o: number;
}

/**
 * Searches title, description and tags (Postgres full-text, `simple` config,
 * prefix matching), ranked by relevance then due date. Without text it is
 * the All view with filters.
 */
export async function searchTasks(userId: string, opts: SearchOptions = {}): Promise<TaskPage> {
  const query = opts.text ? toPrefixQuery(opts.text) : null;
  if (!query) return listTasks(userId, { kind: 'all' }, opts);

  const tx = reader(opts.tx);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let offset = 0;
  if (opts.cursor) {
    try {
      offset = (JSON.parse(Buffer.from(opts.cursor, 'base64url').toString('utf8')) as OffsetCursor).o;
    } catch {
      throw new ValidationError('INVALID_CURSOR', 'Invalid pagination cursor', 'cursor');
    }
    if (!Number.isInteger(offset) || offset < 0) throw new ValidationError('INVALID_CURSOR', 'Invalid pagination cursor', 'cursor');
  }
  const words = (opts.text!.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);

  const ranked = await tx.$queryRaw<Ranked[]>`
    SELECT t."id", (ts_rank(${SEARCH_VECTOR}, q) + CASE WHEN t."tags" && ${words}::text[] THEN 0.5 ELSE 0 END)::float8 AS "rank"
    FROM "Task" t, to_tsquery('simple', ${query}) q
    WHERE t."userId" = ${userId}
      AND t."deletedAt" IS NULL
      AND (${SEARCH_VECTOR} @@ q OR t."tags" && ${words}::text[])
    ORDER BY "rank" DESC
    LIMIT ${MAX_CANDIDATES}`;
  if (ranked.length === 0) return { items: [], nextCursor: null };

  const rankById = new Map(ranked.map((r) => [r.id, Number(r.rank)]));
  const tasks = await tx.task.findMany({
    where: {
      AND: [
        { userId, deletedAt: null, id: { in: ranked.map((r) => r.id) } },
        ...(opts.filter?.includeArchived ? [] : [{ archivedAt: null }]),
        ...filterWhere(opts.filter),
      ],
    },
  });
  const due = (t: Task) => t.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  tasks.sort((a, b) => rankById.get(b.id)! - rankById.get(a.id)! || due(a) - due(b) || (a.id < b.id ? -1 : 1));
  const page = tasks.slice(offset, offset + limit);
  const nextCursor = offset + limit < tasks.length ? Buffer.from(JSON.stringify({ o: offset + limit })).toString('base64url') : null;
  return { items: page.map((task) => ({ task, group: null })), nextCursor };
}

// ───────────────────────── query syntax ─────────────────────────

export interface ParsedQuery {
  text: string;
  status?: TaskStatus[];
  projectName?: string;
  tags: string[];
  due?: 'today' | 'overdue' | 'tomorrow' | 'week' | string;
  minPriority?: number;
}

const STATUS_WORDS: Record<string, TaskStatus[]> = {
  open: [...OPEN_STATUSES],
  inbox: ['INBOX'],
  todo: ['TODO'],
  doing: ['IN_PROGRESS'],
  in_progress: ['IN_PROGRESS'],
  done: ['DONE'],
  completed: ['DONE'],
  cancelled: ['CANCELLED'],
  canceled: ['CANCELLED'],
};

/** Parses `status:done project:work tag:x due:today priority:high free text`. */
export function parseSearchQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { text: '', tags: [] };
  const text: string[] = [];
  for (const token of q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const m = /^(status|project|tag|due|priority):(.+)$/i.exec(token);
    if (!m) {
      text.push(token.replace(/"/g, ''));
      continue;
    }
    const value = m[2].replace(/"/g, '');
    switch (m[1].toLowerCase()) {
      case 'status':
        out.status = STATUS_WORDS[value.toLowerCase()] ?? out.status;
        break;
      case 'project':
        out.projectName = value;
        break;
      case 'tag':
        out.tags.push(value.toLowerCase());
        break;
      case 'due':
        out.due = value.toLowerCase();
        break;
      case 'priority': {
        const key = value.toUpperCase() as keyof typeof PRIORITY;
        if (key in PRIORITY) out.minPriority = PRIORITY[key];
        break;
      }
    }
  }
  out.text = text.join(' ').trim();
  return out;
}

/** Runs a query-syntax search: resolves project names and due tokens for the user. */
export async function searchTasksByQuery(userId: string, q: string, opts: Omit<SearchOptions, 'text'> = {}): Promise<TaskPage> {
  const tx = reader(opts.tx);
  const parsed = parseSearchQuery(q);
  const filter: TaskFilter = { ...opts.filter };
  if (parsed.status) filter.status = parsed.status;
  if (parsed.tags.length) filter.tags = parsed.tags;
  if (parsed.minPriority !== undefined) filter.minPriority = parsed.minPriority;
  if (parsed.projectName) {
    const project = await tx.project.findFirst({
      where: { userId, deletedAt: null, name: { equals: parsed.projectName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!project) return { items: [], nextCursor: null };
    filter.projectId = project.id;
  }
  if (parsed.due) {
    const timeZone = opts.timeZone ?? (await userTimeZone(tx, userId));
    const today = localDateOf(opts.now ?? new Date(), timeZone);
    if (parsed.due === 'overdue') return listTasks(userId, { kind: 'overdue' }, { ...opts, filter, timeZone });
    const day =
      parsed.due === 'today' ? today : parsed.due === 'tomorrow' ? addDays(today, 1) : isLocalDate(parsed.due) ? parsed.due : null;
    const span = parsed.due === 'week' ? 7 : 1;
    const from = parsed.due === 'week' ? today : day;
    if (from) filter.dueOn = { from, toExclusive: addDays(from, span), timeZone };
  }
  return searchTasks(userId, { ...opts, text: parsed.text, filter });
}
