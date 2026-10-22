// GET    /api/projects/:id
// PATCH  /api/projects/:id { version, name?, description?, archived? }
// DELETE /api/projects/:id?version=   — soft delete (tasks keep existing, lose the project)
import { z } from 'zod';
import { deleteProject, getProject, setProjectArchived, updateProject } from '@/lib/projects/repo';
import { json, notFound, parseId, parseQuery, route } from '@/app/api/tasks/_lib/http';
import { toProjectDTO } from '@/app/api/tasks/_lib/serialize';

type Ctx = { params: Promise<{ id: string }> };

const PatchSchema = z
  .object({
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export async function GET(req: Request, { params }: Ctx) {
  return route(req, {}, async ({ userId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    return json({ project: toProjectDTO(await getProject(userId, id)) });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return route(req, { body: PatchSchema }, async ({ userId, body, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    let project = await getProject(userId, id);
    let version = body.version;
    if (body.name !== undefined || body.description !== undefined) {
      project = await updateProject(userId, id, version, { name: body.name, description: body.description }, { requestId });
      version = project.version;
    }
    if (body.archived !== undefined) project = await setProjectArchived(userId, id, version, body.archived, { requestId });
    return json({ project: toProjectDTO(project) });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return route(req, { bodiless: true }, async ({ userId, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const q = parseQuery(req, z.object({ version: z.coerce.number().int().min(1) }));
    if (!q.ok) return q.response;
    return json({ project: toProjectDTO(await deleteProject(userId, id, q.data.version, { requestId })) });
  });
}
