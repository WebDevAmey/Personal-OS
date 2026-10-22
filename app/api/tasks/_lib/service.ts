// app/api/tasks/_lib/service.ts — server-only glue between the task repo and
// the UI (route handlers and server components share it). No Prisma here:
// everything goes through lib/tasks/repo and lib/projects/repo (ADR-006).
import {
  createTask,
  getTask,
  getTaskRelations,
  listReminders,
  listTasks,
  searchTasksByQuery,
  type CreateTaskInput,
  type TaskFilter,
  type TaskSort,
  type TaskStatus,
  type UpdateTaskPatch,
} from '@/lib/tasks/repo';
import { findProjectByName } from '@/lib/projects/repo';
import { getUserTimeZone } from '@/lib/preferences/repo';
import type { TaskDetailDTO, TaskDTO, TaskPageDTO } from '@/components/tasks/types';
import { parseCapture } from '@/components/tasks/capture';
import { type Clock, clockFor, dueFields, instantOf, toReminderDTO, toTaskDTO } from './serialize';
import type { z } from 'zod';
import type { CreateTaskSchema, TaskFieldsSchema, ViewQuerySchema } from './schemas';

export async function userClock(userId: string, now: Date = new Date()): Promise<Clock> {
  return clockFor(await getUserTimeZone(userId), now);
}

const STATUS_VALUES = new Set(['INBOX', 'TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

export type ViewQuery = z.infer<typeof ViewQuerySchema>;

export async function listView(userId: string, q: ViewQuery, clock?: Clock): Promise<TaskPageDTO> {
  const c = clock ?? (await userClock(userId));
  const filter: TaskFilter = {};
  if (q.status) {
    const statuses = q.status.split(',').map((s) => s.trim().toUpperCase()).filter((s) => STATUS_VALUES.has(s));
    if (statuses.length) filter.status = statuses as TaskStatus[];
  }
  if (q.priority !== undefined) filter.priority = [q.priority];
  if (q.tag) filter.tags = [q.tag.toLowerCase()];
  if (q.view === 'project' && !q.projectId) filter.projectId = null;
  else if (q.view !== 'project' && q.projectId) filter.projectId = q.projectId;
  const opts = { cursor: q.cursor ?? null, limit: q.limit ?? 100, sort: q.sort as TaskSort | undefined, filter, timeZone: c.timeZone, now: c.now };
  const page = q.q
    ? await searchTasksByQuery(userId, q.q, opts)
    : await listTasks(userId, q.view === 'project' ? { kind: 'project', projectId: q.projectId } : { kind: q.view }, opts);
  return {
    items: page.items.map((i) => ({ task: toTaskDTO(i.task, c), group: i.group })),
    nextCursor: page.nextCursor,
    today: c.today,
  };
}

export async function taskDetail(userId: string, taskId: string, clock?: Clock): Promise<TaskDetailDTO> {
  const c = clock ?? (await userClock(userId));
  const [task, relations, reminders] = await Promise.all([
    getTask(userId, taskId, { includeDeleted: true }),
    getTaskRelations(userId, taskId),
    listReminders(userId, { taskId }),
  ]);
  const dto = (t: Parameters<typeof toTaskDTO>[0]): TaskDTO => toTaskDTO(t, c);
  return {
    task: dto(task),
    subtasks: relations.subtasks.map(dto),
    dependsOn: relations.dependsOn.map(dto),
    blocks: relations.blocks.map(dto),
    openBlockerIds: relations.openBlockers.map((t) => t.id),
    subtaskProgress: relations.subtaskProgress,
    reminders: reminders.filter((r) => r.status === 'PENDING').map((r) => toReminderDTO(r, c)),
  };
}

type Fields = z.infer<typeof TaskFieldsSchema>;

/** Maps validated UI fields onto a repo patch, converting local dates in the user's zone. */
export function patchFromFields(fields: Fields, timeZone: string): UpdateTaskPatch {
  const patch: UpdateTaskPatch = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.status !== undefined) patch.status = fields.status;
  if (fields.priority !== undefined) patch.priority = fields.priority;
  if (fields.due !== undefined) Object.assign(patch, dueFields(fields.due, timeZone));
  if (fields.start !== undefined) patch.startAt = fields.start ? instantOf(fields.start, timeZone) : null;
  if (fields.estimateMinutes !== undefined) patch.estimateMinutes = fields.estimateMinutes;
  if (fields.projectId !== undefined) patch.projectId = fields.projectId;
  if (fields.parentId !== undefined) patch.parentId = fields.parentId;
  if (fields.tags !== undefined) patch.tags = fields.tags;
  if (fields.recurrenceRule !== undefined) patch.recurrenceRule = fields.recurrenceRule || null;
  return patch;
}

export interface CreateOutcome {
  task: TaskDTO;
  undoEventId: string | null;
  similar: { id: string; title: string }[];
  /** Quick capture named a #project that does not exist; it was not created (FR-211). */
  unknownProject: string | null;
}

export async function createFromBody(userId: string, body: z.infer<typeof CreateTaskSchema>, requestId?: string): Promise<CreateOutcome> {
  const c = await userClock(userId);
  let input: CreateTaskInput;
  let unknownProject: string | null = null;
  let source: 'MANUAL' | 'VOICE' = 'MANUAL';
  if ('capture' in body) {
    const parsed = parseCapture(body.capture, c.today);
    source = body.source ?? 'MANUAL';
    let projectId: string | null = null;
    if (parsed.projectName) {
      const project = await findProjectByName(userId, parsed.projectName);
      if (project) projectId = project.id;
      else unknownProject = parsed.projectName;
    }
    const title = parsed.title || body.capture.replace(/^\s*\+\s*/, '').trim();
    input = {
      title,
      priority: parsed.priority ?? 0,
      tags: parsed.tags,
      projectId,
      timeZone: c.timeZone,
      ...dueFields(parsed.due, c.timeZone),
      // FR: no date and no project → Inbox; otherwise it is planned work.
      status: !parsed.due && !projectId ? 'INBOX' : 'TODO',
    };
  } else {
    const patch = patchFromFields(body, c.timeZone);
    input = {
      ...patch,
      title: body.title,
      timeZone: c.timeZone,
      status: body.status ?? (patch.dueAt || patch.projectId ? 'TODO' : 'INBOX'),
    } as CreateTaskInput;
  }
  const result = await createTask(userId, input, { source, requestId });
  return {
    task: toTaskDTO(result.task, c),
    undoEventId: result.eventIds[0] ?? null,
    similar: result.similar.slice(0, 3).map((s) => ({ id: s.id, title: s.title })),
    unknownProject,
  };
}
