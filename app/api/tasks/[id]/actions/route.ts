// POST /api/tasks/:id/actions — complete · reopen · cancel · restore · snooze
import { cancelTask, completeTask, reopenTask, restoreTask, snoozeTask } from '@/lib/tasks/repo';
import { json, notFound, parseId, route } from '../../_lib/http';
import { ActionSchema } from '../../_lib/schemas';
import { userClock } from '../../_lib/service';
import { instantOf, toTaskDTO } from '../../_lib/serialize';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return route(req, { body: ActionSchema }, async ({ userId, body, requestId }) => {
    const id = parseId((await params).id);
    if (!id) return notFound();
    const clock = await userClock(userId);
    const ctx = { expectedVersion: body.version, source: 'MANUAL' as const, requestId };
    switch (body.action) {
      case 'complete': {
        const r = await completeTask(userId, id, { ...ctx, completeSubtasks: body.completeSubtasks });
        return json({
          task: toTaskDTO(r.task, clock),
          undoEventId: r.eventIds[0] ?? null,
          batchId: r.batchId,
          alreadyCompleted: r.alreadyCompleted,
          warnings: r.warnings,
          nextOccurrence: r.nextOccurrence ? toTaskDTO(r.nextOccurrence, clock) : null,
        });
      }
      case 'reopen':
      case 'restore':
      case 'cancel': {
        const fn = body.action === 'reopen' ? reopenTask : body.action === 'restore' ? restoreTask : cancelTask;
        const r = await fn(userId, id, { ...ctx, ...(body.action === 'cancel' ? { scope: body.scope } : {}) });
        return json({ task: toTaskDTO(r.task, clock), undoEventId: r.eventIds[0] ?? null, batchId: r.batchId });
      }
      case 'snooze': {
        const until = body.until ? instantOf(body.until, clock.timeZone) : null;
        const r = await snoozeTask(userId, id, until, ctx);
        return json({ task: toTaskDTO(r.task, clock), undoEventId: r.eventIds[0] ?? null, batchId: r.batchId });
      }
    }
  });
}
