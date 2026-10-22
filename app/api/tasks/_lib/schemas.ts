// app/api/tasks/_lib/schemas.ts — request schemas for the task routes.
import { z } from 'zod';
import { IdSchema } from './http';
import { LocalDateTimeInput } from './serialize';

export const PrioritySchema = z.number().int().min(0).max(4);
export const TagsSchema = z.array(z.string().trim().min(1).max(32)).max(10);
const OpenStatus = z.enum(['INBOX', 'TODO', 'IN_PROGRESS']);

export const TaskFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20_000).nullable(),
    status: OpenStatus,
    priority: PrioritySchema,
    due: LocalDateTimeInput.nullable(),
    start: LocalDateTimeInput.nullable(),
    estimateMinutes: z.number().int().min(5).max(1440).nullable(),
    projectId: IdSchema.nullable(),
    parentId: IdSchema.nullable(),
    tags: TagsSchema,
    recurrenceRule: z.string().max(200).nullable(),
  })
  .partial()
  .strict();

export const CreateTaskSchema = z.union([
  z.object({ capture: z.string().trim().min(1).max(600), source: z.enum(['MANUAL', 'VOICE']).optional() }).strict(),
  TaskFieldsSchema.extend({ title: z.string().trim().min(1).max(500) }).strict(),
]);

export const UpdateTaskSchema = TaskFieldsSchema.extend({ version: z.number().int().min(1) }).strict();

export const ViewQuerySchema = z.object({
  view: z.enum(['today', 'upcoming', 'inbox', 'overdue', 'completed', 'all', 'project']).default('all'),
  projectId: IdSchema.optional(),
  sort: z.enum(['default', 'due', 'priority', 'created', 'updated', 'title']).optional(),
  status: z.string().max(80).optional(),
  priority: z.coerce.number().int().min(0).max(4).optional(),
  tag: z.string().trim().min(1).max(32).optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete'), version: z.number().int().min(1).optional(), completeSubtasks: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('reopen'), version: z.number().int().min(1).optional() }).strict(),
  z.object({ action: z.literal('cancel'), version: z.number().int().min(1).optional(), scope: z.enum(['occurrence', 'series']).optional() }).strict(),
  z.object({ action: z.literal('restore'), version: z.number().int().min(1).optional() }).strict(),
  z.object({ action: z.literal('snooze'), version: z.number().int().min(1).optional(), until: LocalDateTimeInput.nullable() }).strict(),
]);

export const UndoSchema = z.union([
  z.object({ eventId: IdSchema, scope: z.enum(['recent', 'history']).default('recent') }).strict(),
  z.object({ batchId: z.string().min(1).max(64), scope: z.enum(['recent', 'history']).default('recent') }).strict(),
]);

export const BulkChangeSchema = z
  .object({
    complete: z.literal(true),
    cancel: z.literal(true),
    reopen: z.literal(true),
    delete: z.literal(true),
    priority: PrioritySchema,
    due: LocalDateTimeInput.nullable(),
    shiftDueDays: z.number().int().min(-365).max(365),
    projectId: IdSchema.nullable(),
    addTags: TagsSchema,
    removeTags: TagsSchema,
    snooze: LocalDateTimeInput.nullable(),
  })
  .partial()
  .strict()
  .refine((c) => Object.keys(c).length > 0, 'Nothing to change');

export const BulkSchema = z
  .object({
    ids: z.array(IdSchema).min(1).max(500),
    change: BulkChangeSchema,
    mode: z.enum(['preview', 'apply']),
    expected: z.array(z.object({ id: IdSchema, version: z.number().int().min(1) }).strict()).max(500).optional(),
  })
  .strict();

export const DependencySchema = z.object({ dependsOnId: IdSchema }).strict();
export const ReminderSchema = z.object({ at: LocalDateTimeInput }).strict();
