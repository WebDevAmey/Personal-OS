// app/api/tasks/_lib/settings.ts — serialisers and schemas for the settings
// routes (preferences, memory). Kept out of route.ts files because Next only
// allows HTTP handlers to be exported from those.
import { z } from 'zod';
import type { UserPreference } from '@/lib/preferences/repo';
import type { MemoryRecord } from '@/lib/memory/repo';
import type { MemoryDTO, PreferencesDTO } from '@/components/settings/types';
import { HHmmSchema } from './serialize';

export const PreferencesPatchSchema = z
  .object({
    timeZone: z.string().min(1).max(64),
    locale: z.string().min(2).max(35),
    weekStart: z.number().int().min(0).max(6),
    // FR-301: configurable 04:00–11:00 in 15-minute steps.
    briefingHour: z.number().int().min(4).max(11),
    briefingMinute: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]),
    workdayStart: HHmmSchema.nullable(),
    workdayEnd: HHmmSchema.nullable(),
    lunchEndsAt: HHmmSchema.nullable(),
    reminderEmailEnabled: z.boolean(),
    speechOutputEnabled: z.boolean(),
    reducedMotion: z.enum(['SYSTEM', 'REDUCE', 'FULL']),
  })
  .partial()
  .strict();

export function toPreferencesDTO(p: UserPreference): PreferencesDTO {
  return {
    timeZone: p.timeZone,
    locale: p.locale,
    weekStart: p.weekStart,
    briefingHour: p.briefingHour,
    briefingMinute: p.briefingMinute,
    workdayStart: p.workdayStart,
    workdayEnd: p.workdayEnd,
    lunchEndsAt: p.lunchEndsAt,
    reminderEmailEnabled: p.reminderEmailEnabled,
    speechOutputEnabled: p.speechOutputEnabled,
    reducedMotion: p.reducedMotion,
    version: p.version,
  };
}

export const MemoryContentSchema = z.object({ content: z.string().trim().min(1).max(4000) }).strict();

export function toMemoryDTO(m: MemoryRecord): MemoryDTO {
  return {
    id: m.id,
    content: m.content,
    source: m.source,
    embedded: m.embedded,
    createdAt: m.createdAt.toISOString(),
    deletedAt: m.deletedAt?.toISOString() ?? null,
  };
}

export const ProjectCreateSchema = z
  .object({ name: z.string().trim().min(1).max(100), description: z.string().max(2000).nullish() })
  .strict();
