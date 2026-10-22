// GET    /api/tasks/:id                       — task detail (fields, subtasks, dependencies, reminders)
// PATCH  /api/tasks/:id   { version, ...fields } — optimistic-concurrency update
// DELETE /api/tasks/:id?version=&scope=        — soft delete (undoable)
import { z } from 'zod';
import { softDeleteTask, updateTask } from '@/lib/tasks/repo';
import { json, notFound, parseId, parseQuery, route } from '../_lib/http';
import { UpdateTaskSchema } from '../_lib/schemas';
import { taskDetail, patchFromFields, userClock } from '../_lib/service';
import { toTaskDTO } from '../_lib/serialize';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return route(req, {}, async ({ userId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    return json(await taskDetail(userId, id));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return route(req, { body: UpdateTaskSchema, maxBytes: 32 * 1024 }, async ({ userId, body, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const clock = await userClock(userId);
    const { version, ...fields } = body;
    const result = await updateTask(userId, id, version, patchFromFields(fields, clock.timeZone), { source: 'MANUAL', requestId });
    return json({ task: toTaskDTO(result.task, clock), undoEventId: result.eventIds[0] ?? null });
  });
}

const DeleteQuery = z.object({
  version: z.coerce.number().int().min(1).optional(),
  scope: z.enum(['occurrence', 'series']).optional(),
});

export async function DELETE(req: Request, { params }: Ctx) {
  return route(req, { bodiless: true }, async ({ userId, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const q = parseQuery(req, DeleteQuery);
    if (!q.ok) return q.response;
    const clock = await userClock(userId);
    const result = await softDeleteTask(userId, id, { expectedVersion: q.data.version, scope: q.data.scope, source: 'MANUAL', requestId });
    return json({ task: toTaskDTO(result.task, clock), undoEventId: result.eventIds[0] ?? null });
  });
}
