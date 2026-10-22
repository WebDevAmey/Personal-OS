// POST   /api/tasks/:id/reminders { at: { date, time } }  — remind at a local time
// DELETE /api/tasks/:id/reminders?reminderId=
import { z } from 'zod';
import { cancelReminder, createReminder, getReminder } from '@/lib/tasks/repo';
import { IdSchema, json, notFound, parseId, parseQuery, route } from '../../_lib/http';
import { ReminderSchema } from '../../_lib/schemas';
import { userClock } from '../../_lib/service';
import { instantOf, toReminderDTO } from '../../_lib/serialize';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return route(req, { body: ReminderSchema }, async ({ userId, body, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const clock = await userClock(userId);
    const r = await createReminder(userId, { taskId: id, remindAt: instantOf(body.at, clock.timeZone) }, { source: 'MANUAL', requestId });
    return json({ reminder: toReminderDTO(r.reminder, clock), undoEventId: r.eventIds[0] ?? null }, 201);
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return route(req, { bodiless: true }, async ({ userId, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const q = parseQuery(req, z.object({ reminderId: IdSchema }));
    if (!q.ok) return q.response;
    // The reminder must belong to this task (and, through the repo, to this user).
    const existing = await getReminder(userId, q.data.reminderId);
    if (existing.taskId !== id) return notFound();
    const r = await cancelReminder(userId, q.data.reminderId, { source: 'MANUAL', requestId });
    return json({ undoEventId: r.eventIds[0] ?? null });
  });
}
