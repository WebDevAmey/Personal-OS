// GET /api/tasks/:id/history?cursor= — append-only timeline, newest first (FR-263)
import { z } from 'zod';
import { listTaskHistory } from '@/lib/tasks/repo';
import { json, notFound, parseId, parseQuery, route } from '../../_lib/http';
import { toEventDTO } from '../../_lib/serialize';

type Ctx = { params: Promise<{ id: string }> };
const Query = z.object({ cursor: z.string().max(512).optional() });

export async function GET(req: Request, { params }: Ctx) {
  return route(req, {}, async ({ userId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const q = parseQuery(req, Query);
    if (!q.ok) return q.response;
    const page = await listTaskHistory(userId, id, { cursor: q.data.cursor ?? null, limit: 50 });
    // An event is "undone" when a later UNDONE event in this page points at it
    // (TaskEvent.after carries no pointer, so read revertsEventId off the rows).
    const undone = new Set(
      page.events.map((e) => (e as { revertsEventId?: string | null }).revertsEventId).filter((v): v is string => Boolean(v)),
    );
    return json({ events: page.events.map((e) => toEventDTO(e, undone)), nextCursor: page.nextCursor });
  });
}
