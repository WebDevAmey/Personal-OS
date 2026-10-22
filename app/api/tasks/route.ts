// GET  /api/tasks  — a task view (today, upcoming, inbox, overdue, completed, all, project) or search (?q=)
// POST /api/tasks  — create a task from fields, or from a quick-capture line ({ capture })
import { json, parseQuery, route } from './_lib/http';
import { CreateTaskSchema, ViewQuerySchema } from './_lib/schemas';
import { createFromBody, listView } from './_lib/service';

export async function GET(req: Request) {
  return route(req, {}, async ({ userId }) => {
    const q = parseQuery(req, ViewQuerySchema);
    if (!q.ok) return q.response;
    return json(await listView(userId, q.data));
  });
}

export async function POST(req: Request) {
  return route(req, { body: CreateTaskSchema, maxBytes: 32 * 1024 }, async ({ userId, body, requestId }) =>
    json(await createFromBody(userId, body, requestId), 201),
  );
}
