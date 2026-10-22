// lib/briefing/types.ts — shared contracts for the morning briefing
// (ADR-010, docs/00 FR-3xx, docs/08 ARCH-005).
//
// - `BriefingItem` is what the UI renders (stored in DailyBriefing.items).
// - `BriefingRequestedSchema` validates the `briefing/generate.requested`
//   event at function entry: a malformed payload is rejected and never
//   processed for any user.
import { z } from 'zod';
import { isLocalDate } from '@/lib/time';

export const BRIEFING_EVENT = 'briefing/generate.requested' as const;

/** Entity kinds an item may cite. Ids are checked against what the run fetched. */
export const SOURCE_TYPES = ['email', 'event', 'task', 'memory'] as const;
export type BriefingSourceType = (typeof SOURCE_TYPES)[number];

export const ITEM_KINDS = ['task', 'email', 'event', 'reminder', 'digest'] as const;
export type BriefingItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_PRIORITIES = ['high', 'medium', 'low'] as const;
export type BriefingItemPriority = (typeof ITEM_PRIORITIES)[number];

export interface BriefingSource {
  type: BriefingSourceType;
  /** Task id, Gmail message id, Calendar event id or Memory id fetched by the run. */
  id: string;
  /** Server-built label (never model text), e.g. the task title or "Jordan Lee · Next steps". */
  label: string;
}

export interface BriefingItem {
  /** Stable within a briefing; use as a React key. */
  id: string;
  kind: BriefingItemKind;
  /** ≤ 90 chars, plain text. */
  title: string;
  /** ≤ 140 chars, plain text. */
  reason: string;
  priority: BriefingItemPriority;
  /** true when the item interprets intent/importance rather than restating source facts (FR-307). */
  isInferred: boolean;
  /** ≥ 1, every one grounded in data fetched by the run (FR-306). */
  sources: BriefingSource[];
  /** Optional command text the UI can pre-fill in the command bar (runs through the normal pipeline). */
  suggestedCommand?: string;
}

/** Sources a run reads; a failure of gmail/calendar/memory makes the run PARTIAL. */
export const SOURCE_NAMES = ['tasks', 'gmail', 'calendar', 'memory'] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

export type SourceErrorClass = 'auth' | 'quota' | 'network' | 'unknown';

export interface SourceStatus {
  status: 'ok' | 'failed' | 'not_connected' | 'skipped';
  errorClass?: SourceErrorClass;
  count?: number;
  at: string;
}

export const TITLE_MAX = 90;
export const REASON_MAX = 140;
export const SUGGESTED_COMMAND_MAX = 120;
export const MAX_ATTENTION_ITEMS = 7;
export const MAX_DIGEST_ITEMS = 5;
export const MAX_EMAIL_ITEMS = 3;

const SAFE_ID = /^[A-Za-z0-9_.:@-]{1,128}$/;

export const BriefingSourceSchema = z.object({
  type: z.enum(SOURCE_TYPES),
  id: z.string().regex(SAFE_ID),
  label: z.string().max(200),
});

/** Validates stored items on read (legacy or corrupted rows are dropped, not rendered). */
export const BriefingItemSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(ITEM_KINDS),
  title: z.string().min(1).max(TITLE_MAX),
  reason: z.string().max(REASON_MAX),
  priority: z.enum(ITEM_PRIORITIES),
  isInferred: z.boolean(),
  sources: z.array(BriefingSourceSchema).min(1).max(5),
  suggestedCommand: z.string().max(SUGGESTED_COMMAND_MAX).optional(),
});

// ───────────────────────── event payload (ARCH-005) ─────────────────────────

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const BRIEFING_TRIGGERS = ['SCHEDULED', 'PAGE_LOAD', 'RETRY'] as const;
export type BriefingEventTrigger = (typeof BRIEFING_TRIGGERS)[number];

/**
 * `dedupeKey` is the Inngest idempotency key: `${userId}-${localDate}` for the
 * first run of a day (ADR-010), `${userId}-${localDate}-r${n}` for a retry
 * that regenerates into the same BriefingRun row (FR-310).
 */
export const BriefingRequestedSchema = z
  .object({
    userId: z.string().regex(USER_ID),
    localDate: z.string().refine(isLocalDate, 'localDate must be YYYY-MM-DD'),
    dedupeKey: z.string().max(200),
    trigger: z.enum(BRIEFING_TRIGGERS),
    requestId: z.string().max(100).optional(),
  })
  .strict()
  .refine((d) => d.dedupeKey === dedupeKeyFor(d.userId, d.localDate, 0) || d.dedupeKey.startsWith(`${d.userId}-${d.localDate}-r`), {
    message: 'dedupeKey does not match userId/localDate',
    path: ['dedupeKey'],
  });

export type BriefingRequested = z.infer<typeof BriefingRequestedSchema>;

export function dedupeKeyFor(userId: string, localDate: string, attempts: number): string {
  return attempts > 0 ? `${userId}-${localDate}-r${attempts}` : `${userId}-${localDate}`;
}

// ───────────────────────── read API (lib/briefing/today.ts) ─────────────────────────

export type TodayBriefingStatus = 'ready' | 'preparing' | 'failed' | 'none';

export interface TodayBriefing {
  status: TodayBriefingStatus;
  briefing?: {
    localDate: string;
    generatedAt: string;
    isStale: boolean;
    partialSources: string[];
    items: BriefingItem[];
  };
}

export type EnsureQueuedResult = 'queued' | 'exists' | 'running';
