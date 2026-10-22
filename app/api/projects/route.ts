// GET  /api/projects            — projects with open-task counts
// POST /api/projects { name, description? }
import { createProject, listProjects } from '@/lib/projects/repo';
import { json, route } from '@/app/api/tasks/_lib/http';
import { toProjectDTO } from '@/app/api/tasks/_lib/serialize';
import { ProjectCreateSchema } from '@/app/api/tasks/_lib/settings';

export async function GET(req: Request) {
  return route(req, {}, async ({ userId }) => {
    const archived = new URL(req.url).searchParams.get('archived') === '1';
    return json({ projects: (await listProjects(userId, { includeArchived: archived })).map(toProjectDTO) });
  });
}

export async function POST(req: Request) {
  return route(req, { body: ProjectCreateSchema }, async ({ userId, body, requestId }) => {
    const project = await createProject(userId, { name: body.name, description: body.description ?? null }, { requestId });
    return json({ project: toProjectDTO(project) }, 201);
  });
}
