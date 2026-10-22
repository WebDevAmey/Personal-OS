// POST   /api/tasks/:id/dependencies { dependsOnId }  — "this task is blocked by"
// DELETE /api/tasks/:id/dependencies?dependsOnId=
import { z } from 'zod';
import { addDependency, removeDependency } from '@/lib/tasks/repo';
import { IdSchema, json, notFound, parseId, parseQuery, route } from '../../_lib/http';
import { DependencySchema } from '../../_lib/schemas';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return route(req, { body: DependencySchema }, async ({ userId, body, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const r = await addDependency(userId, id, body.dependsOnId, { source: 'MANUAL', requestId });
    return json({ undoEventId: r.eventIds[0] ?? null }, 201);
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return route(req, { bodiless: true }, async ({ userId, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const q = parseQuery(req, z.object({ dependsOnId: IdSchema }));
    if (!q.ok) return q.response;
    const r = await removeDependency(userId, id, q.data.dependsOnId, { source: 'MANUAL', requestId });
    return json({ undoEventId: r.eventIds[0] ?? null });
  });
}
