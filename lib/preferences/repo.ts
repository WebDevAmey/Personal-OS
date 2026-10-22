// lib/preferences/repo.ts — UserPreference persistence (docs/03 §2).
// One row per user; reads create the default row on first access so callers
// never handle "no preferences". The DB CHECK (UserPreference_time_check)
// backs the validation below.
import { ConflictError, ValidationError } from '@/lib/db/errors';
import { type Tx, isUniqueViolation, reader, withTransaction } from '@/lib/db/tx';
import type { ActorType, MotionPreference, UserPreference } from '@/lib/generated/prisma/client';
import { recordAudit } from '@/lib/audit/audit-events';
import { isHHmm, isValidTimeZone } from '@/lib/time';

export type { UserPreference };

export interface PreferencesPatch {
  timeZone?: string;
  locale?: string;
  weekStart?: number;
  briefingHour?: number;
  briefingMinute?: number;
  workdayStart?: string | null;
  workdayEnd?: string | null;
  lunchEndsAt?: string | null;
  reminderEmailEnabled?: boolean;
  briefingWebSearchEnabled?: boolean;
  speechOutputEnabled?: boolean;
  reducedMotion?: MotionPreference;
}

export interface PreferencesContext {
  actorType?: ActorType;
  requestId?: string;
  agentRunId?: string;
  /** Optimistic concurrency; omit for last-write-wins settings toggles. */
  expectedVersion?: number;
  tx?: Tx;
}

const MOTION: readonly MotionPreference[] = ['SYSTEM', 'REDUCE', 'FULL'];

function intIn(field: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ValidationError('OUT_OF_RANGE', `${field} must be an integer between ${min} and ${max}`, field);
  }
  return v;
}

function hhmm(field: string, v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || !isHHmm(v)) throw new ValidationError('INVALID_TIME', `${field} must be HH:mm`, field);
  return v;
}

function bool(field: string, v: unknown): boolean {
  if (typeof v !== 'boolean') throw new ValidationError('INVALID_BOOLEAN', `${field} must be a boolean`, field);
  return v;
}

/** Validates and normalises a patch; unknown keys are rejected so callers can't write arbitrary columns. */
export function validatePreferencesPatch(patch: Record<string, unknown>): PreferencesPatch {
  const out: PreferencesPatch = {};
  for (const [key, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    switch (key) {
      case 'timeZone':
        if (typeof v !== 'string' || !isValidTimeZone(v)) throw new ValidationError('INVALID_TIME_ZONE', 'timeZone must be an IANA time zone', 'timeZone');
        out.timeZone = v;
        break;
      case 'locale': {
        if (typeof v !== 'string') throw new ValidationError('INVALID_LOCALE', 'locale must be a BCP 47 tag', 'locale');
        try {
          out.locale = Intl.getCanonicalLocales(v)[0];
        } catch {
          throw new ValidationError('INVALID_LOCALE', 'locale must be a BCP 47 tag', 'locale');
        }
        break;
      }
      case 'weekStart':
        out.weekStart = intIn(key, v, 0, 6);
        break;
      case 'briefingHour':
        out.briefingHour = intIn(key, v, 0, 23);
        break;
      case 'briefingMinute':
        out.briefingMinute = intIn(key, v, 0, 59);
        break;
      case 'workdayStart':
      case 'workdayEnd':
      case 'lunchEndsAt':
        out[key] = hhmm(key, v);
        break;
      case 'reminderEmailEnabled':
      case 'briefingWebSearchEnabled':
      case 'speechOutputEnabled':
        out[key] = bool(key, v);
        break;
      case 'reducedMotion':
        if (!MOTION.includes(v as MotionPreference)) throw new ValidationError('INVALID_ENUM', 'reducedMotion must be SYSTEM, REDUCE or FULL', key);
        out.reducedMotion = v as MotionPreference;
        break;
      default:
        throw new ValidationError('UNKNOWN_FIELD', `Unknown preference: ${key}`, key);
    }
  }
  return out;
}

/** Returns the user's preferences, creating the default row if missing. */
export async function getPreferences(userId: string, opts: { tx?: Tx } = {}): Promise<UserPreference> {
  const db = reader(opts.tx);
  const existing = await db.userPreference.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await db.userPreference.create({ data: { userId } });
  } catch (e) {
    // Two concurrent first reads: the loser reads the winner's row.
    if (isUniqueViolation(e)) return db.userPreference.findUniqueOrThrow({ where: { userId } });
    throw e;
  }
}

/** The user's IANA zone (falls back to UTC only if the row cannot exist, e.g. user deleted). */
export async function getUserTimeZone(userId: string, opts: { tx?: Tx } = {}): Promise<string> {
  const row = await reader(opts.tx).userPreference.findUnique({ where: { userId }, select: { timeZone: true } });
  return row?.timeZone ?? 'UTC';
}

export async function updatePreferences(userId: string, patch: PreferencesPatch, ctx: PreferencesContext = {}): Promise<UserPreference> {
  const data = validatePreferencesPatch(patch as Record<string, unknown>);
  return withTransaction(async (tx) => {
    const before = await getPreferences(userId, { tx });
    if (Object.keys(data).length === 0) return before;
    const where = { userId, ...(ctx.expectedVersion !== undefined ? { version: ctx.expectedVersion } : { version: before.version }) };
    const res = await tx.userPreference.updateMany({ where, data: { ...data, version: { increment: 1 } } });
    if (res.count === 0) {
      const current = await tx.userPreference.findUniqueOrThrow({ where: { userId }, select: { version: true } });
      throw new ConflictError('UserPreference', 'VERSION_MISMATCH', { currentVersion: current.version, expectedVersion: where.version });
    }
    const after = await tx.userPreference.findUniqueOrThrow({ where: { userId } });
    const fields = Object.keys(data) as (keyof PreferencesPatch)[];
    await recordAudit(tx, {
      userId,
      actorType: ctx.actorType ?? 'USER',
      action: 'preference.update',
      entityType: 'UserPreference',
      entityId: userId,
      agentRunId: ctx.agentRunId,
      requestId: ctx.requestId,
      metadata: { fields, before: Object.fromEntries(fields.map((f) => [f, before[f]])), after: Object.fromEntries(fields.map((f) => [f, after[f]])) },
    });
    return after;
  }, { tx: ctx.tx });
}
