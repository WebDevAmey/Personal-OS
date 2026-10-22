// PATCH  /api/memory/:id { content }   — edit (re-embedded by the background job)
// DELETE /api/memory/:id               — soft delete, restorable (FR-603)
// POST   /api/memory/:id               — restore a deleted memory
import { deleteMemory, restoreMemory, updateMemory } from '@/lib/memory/repo';
import { json, notFound, parseId, route } from '@/app/api/tasks/_lib/http';
import { MemoryContentSchema, toMemoryDTO } from '@/app/api/tasks/_lib/settings';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return route(req, { body: MemoryContentSchema }, async ({ userId, body, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    return json({ memory: toMemoryDTO(await updateMemory(userId, id, body.content, { requestId })) });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return route(req, { bodiless: true }, async ({ userId, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    return json({ memory: toMemoryDTO(await deleteMemory(userId, id, { requestId })) });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return route(req, { bodiless: true }, async ({ userId, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    return json({ memory: toMemoryDTO(await restoreMemory(userId, id, { requestId })) });
  });
}
