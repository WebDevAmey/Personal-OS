// POST /api/tasks/bulk { ids, change, mode, expected? } (FR-260/261)
// mode "preview" writes nothing and returns the count, up to 10 titles and the
// `expected` id/version set; mode "apply" with that set refuses (409) if any
// target changed in between. One batchId → one Undo for the whole batch.
import { applyBulkUpdate, previewBulkUpdate, type BulkChange } from '@/lib/tasks/repo';
import { json, route } from '../_lib/http';
import { BulkSchema } from '../_lib/schemas';
import { userClock } from '../_lib/service';
import { dueFields, instantOf, toTaskDTO } from '../_lib/serialize';

export async function POST(req: Request) {
  return route(req, { body: BulkSchema, maxBytes: 64 * 1024 }, async ({ userId, body, requestId }) => {
    const clock = await userClock(userId);
    const { due, snooze, ...rest } = body.change;
    const change: BulkChange = { ...rest };
    if (due !== undefined) Object.assign(change, dueFields(due, clock.timeZone));
    if (snooze !== undefined) change.snoozedUntil = snooze ? instantOf(snooze, clock.timeZone) : null;
    const selector = { ids: body.ids };

    if (body.mode === 'preview') {
      const p = await previewBulkUpdate(userId, selector, change, { timeZone: clock.timeZone });
      return json({ count: p.count, titles: p.targets.slice(0, 10).map((t) => t.title), expected: p.expected });
    }
    const r = await applyBulkUpdate(userId, selector, change, {
      expected: body.expected,
      timeZone: clock.timeZone,
      source: 'MANUAL',
      requestId,
    });
    return json({ batchId: r.batchId, tasks: r.tasks.map((t) => toTaskDTO(t, clock)) });
  });
}
