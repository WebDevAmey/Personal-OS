// lib/tasks/validation.ts — pure field rules for tasks (docs/00 §5.2).
import { ValidationError } from '@/lib/db/errors';
import { isFloatingDate, isValidTimeZone } from '@/lib/time';
import type { Task, TaskSource } from './types';
import { RecurrenceRuleError, normalizeRRule } from './recurrence';

export const LIMITS = {
  titleMax: 500,
  descriptionMax: 20_000,
  tagMax: 32,
  tagsPerTask: 10,
  estimateMin: 5,
  estimateMax: 1440,
  sourceRefMax: 500,
} as const;

export function normalizeTitle(title: unknown): string {
  if (typeof title !== 'string') throw new ValidationError('TITLE_REQUIRED', 'Title is required', 'title');
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) throw new ValidationError('TITLE_REQUIRED', 'Title is required', 'title');
  if (trimmed.length > LIMITS.titleMax) throw new ValidationError('TITLE_TOO_LONG', `Title is longer than ${LIMITS.titleMax} characters`, 'title');
  return trimmed;
}

export function normalizeDescription(description: string | null | undefined): string | null {
  if (description === null || description === undefined) return null;
  if (description.length > LIMITS.descriptionMax) {
    throw new ValidationError('DESCRIPTION_TOO_LONG', `Description is longer than ${LIMITS.descriptionMax} characters`, 'description');
  }
  return description.trim().length === 0 ? null : description;
}

export function normalizeTag(tag: string): string {
  const t = tag.trim().replace(/^[#@]/, '').toLowerCase();
  if (t.length === 0 || t.length > LIMITS.tagMax) throw new ValidationError('INVALID_TAG', `Tags must be 1–${LIMITS.tagMax} characters`, 'tags');
  if (/[\s,]/.test(t)) throw new ValidationError('INVALID_TAG', 'Tags cannot contain spaces or commas', 'tags');
  return t;
}

export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const out = [...new Set(tags.map(normalizeTag))];
  if (out.length > LIMITS.tagsPerTask) throw new ValidationError('TOO_MANY_TAGS', `At most ${LIMITS.tagsPerTask} tags per task`, 'tags');
  return out;
}

export function validatePriority(priority: number): number {
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    throw new ValidationError('INVALID_PRIORITY', 'Priority must be 0 (none) to 4 (urgent)', 'priority');
  }
  return priority;
}

export function validateEstimate(estimate: number | null | undefined): number | null {
  if (estimate === null || estimate === undefined) return null;
  if (!Number.isInteger(estimate) || estimate < LIMITS.estimateMin || estimate > LIMITS.estimateMax) {
    throw new ValidationError('INVALID_ESTIMATE', `Estimate must be ${LIMITS.estimateMin}–${LIMITS.estimateMax} minutes`, 'estimateMinutes');
  }
  return estimate;
}

export function validateDate(value: Date | null | undefined, field: string): Date | null {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new ValidationError('INVALID_DATE', `${field} is not a valid date`, field);
  return value;
}

/** Date-only deadlines must be floating dates (00:00:00.000Z), see docs/03 §1. */
export function validateDue(dueAt: Date | null, dueHasTime: boolean): void {
  if (dueAt && !dueHasTime && !isFloatingDate(dueAt)) {
    throw new ValidationError('DATE_ONLY_NOT_MIDNIGHT', 'A date-only due date must be a calendar date at 00:00Z (use floatingDate())', 'dueAt');
  }
}

export function validateTimeZone(tz: string | null | undefined): string | null {
  if (tz === null || tz === undefined) return null;
  if (!isValidTimeZone(tz)) throw new ValidationError('INVALID_TIME_ZONE', `Unknown time zone ${tz}`, 'timeZone');
  return tz;
}

export function validateRecurrence(rule: string | null | undefined): string | null {
  if (rule === null || rule === undefined || rule === '') return null;
  try {
    return normalizeRRule(rule);
  } catch (e) {
    if (e instanceof RecurrenceRuleError) throw new ValidationError('INVALID_RECURRENCE', e.message, 'recurrenceRule');
    throw e;
  }
}

export function validateSourceRef(ref: string | null | undefined): string | null {
  if (ref === null || ref === undefined) return null;
  if (ref.length > LIMITS.sourceRefMax) throw new ValidationError('SOURCE_REF_TOO_LONG', 'sourceRef is too long', 'sourceRef');
  return ref;
}

export function actorFor(source: TaskSource | undefined): 'USER' | 'AGENT' | 'SYSTEM' {
  switch (source) {
    case 'COMMAND':
    case 'VOICE':
      return 'AGENT';
    case 'EMAIL':
    case 'BRIEFING':
      return 'SYSTEM';
    default:
      return 'USER';
  }
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'and', 'on', 'in', 'my', 'at', 'with']);

/** FR-214 normalisation: lowercase, punctuation and stop-words stripped. */
export function normalizeForSimilarity(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(' ');
}

/** SQL twin of normalizeForSimilarity (applied to stored titles). */
export const SQL_NORMALIZED_TITLE = `btrim(regexp_replace(regexp_replace(regexp_replace(lower("title"), '[^[:alnum:][:space:]]+', ' ', 'g'), '\\m(a|an|the|to|for|of|and|on|in|my|at|with)\\M', ' ', 'g'), '\\s+', ' ', 'g'))`;

// ───────────────────────── event snapshots ─────────────────────────

export const TRACKED_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'dueAt',
  'dueHasTime',
  'startAt',
  'timeZone',
  'estimateMinutes',
  'projectId',
  'parentId',
  'tags',
  'recurrenceRule',
  'recurrenceSeriesId',
  'snoozedUntil',
  'sourceRef',
  'completedAt',
  'archivedAt',
  'deletedAt',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];
export const DATE_FIELDS = new Set<TrackedField>(['dueAt', 'startAt', 'snoozedUntil', 'completedAt', 'archivedAt', 'deletedAt']);

export type Snapshot = Partial<Record<TrackedField, unknown>>;

function toJson(field: TrackedField, value: unknown): unknown {
  if (value === undefined) return null;
  if (DATE_FIELDS.has(field)) return value ? (value as Date).toISOString() : null;
  return value;
}

export function fromJson(field: TrackedField, value: unknown): unknown {
  if (DATE_FIELDS.has(field)) return value ? new Date(value as string) : null;
  return value;
}

function same(field: TrackedField, a: unknown, b: unknown): boolean {
  if (DATE_FIELDS.has(field)) {
    const x = a ? (a as Date).getTime() : null;
    const y = b ? (b as Date).getTime() : null;
    return x === y;
  }
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? null) === (b ?? null);
}

/** Changed fields only: { before, after } JSON images for a TaskEvent. */
export function diffTask(before: Partial<Task>, after: Partial<Task>, fields: readonly TrackedField[] = TRACKED_FIELDS) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f in after)) continue;
    const bv = (before as Record<string, unknown>)[f];
    const av = (after as Record<string, unknown>)[f];
    if (!same(f, bv, av)) {
      b[f] = toJson(f, bv);
      a[f] = toJson(f, av);
    }
  }
  return { before: b, after: a, changed: Object.keys(a) as TrackedField[] };
}

/** Converts a stored before/after image back to Prisma data. */
export function snapshotToData(image: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(image)) {
    if ((TRACKED_FIELDS as readonly string[]).includes(k)) out[k] = fromJson(k as TrackedField, v);
  }
  return out;
}
