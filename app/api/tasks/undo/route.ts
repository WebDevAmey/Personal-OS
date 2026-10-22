// POST /api/tasks/undo { eventId | batchId, scope } — reverts a change (FR-262).
// scope "recent" uses the 10-minute toast window; "history" allows 7 days.
import { undoBatch, undoEvent, UNDO_WINDOW_MS } from '@/lib/tasks/repo';
import { json, route } from '../_lib/http';
import { UndoSchema } from '../_lib/schemas';
import { userClock } from '../_lib/service';
import { toTaskDTO } from '../_lib/serialize';

const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  return route(req, { body: UndoSchema }, async ({ userId, body, requestId }) => {
    const windowMs = body.scope === 'history' ? HISTORY_WINDOW_MS : UNDO_WINDOW_MS;
    const ctx = { source: 'MANUAL' as const, requestId, windowMs };
    const r = 'eventId' in body ? await undoEvent(userId, body.eventId, ctx) : await undoBatch(userId, body.batchId, ctx);
    const clock = await userClock(userId);
    return json({ tasks: r.tasks.map((t) => toTaskDTO(t, clock)) });
  });
}
