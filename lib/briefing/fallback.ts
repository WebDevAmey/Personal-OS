// lib/briefing/fallback.ts — deterministic briefing built only from fetched
// data, used when the model call fails or returns an invalid object. Every
// item restates source fields (isInferred = false); nothing is invented.
import type { BriefingContext } from './context';
import { cleanText, factualTaskItem, fetchedIndex, groundItems, type CandidateItem } from './grounding';
import { MAX_ATTENTION_ITEMS, type BriefingItem } from './types';

const BUCKET_ORDER = { overdue: 0, today: 1, snoozed_waking: 2, upcoming: 3 } as const;

export function buildFallbackItems(ctx: BriefingContext): BriefingItem[] {
  const idx = fetchedIndex(ctx);
  const candidates: CandidateItem[] = [];

  const tasks = ctx.tasks
    .filter((t) => t.bucket !== 'upcoming' || t.priority >= 3)
    .sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || b.priority - a.priority);
  for (const t of tasks) {
    const item = factualTaskItem(t, idx.get('task')!.get(t.id)!);
    candidates.push({ ...item, sources: item.sources.map(({ type, id }) => ({ type, id })) });
  }

  for (const r of ctx.reminders) {
    if (!r.taskId) continue;
    candidates.push({
      kind: 'reminder',
      title: cleanText(r.title, 90),
      reason: `Reminder at ${r.at} today`,
      priority: 'medium',
      isInferred: false,
      sources: [{ type: 'task', id: r.taskId }],
    });
  }

  if (ctx.events.length > 0) {
    const timed = ctx.events.filter((e) => !e.allDay);
    const first = timed[0] ? idx.get('event')!.get(timed[0].id) : undefined;
    candidates.push({
      kind: 'digest',
      title: `${ctx.events.length} calendar event${ctx.events.length === 1 ? '' : 's'} today`,
      reason: first ? `First: ${first}` : 'All-day events only',
      priority: 'low',
      isInferred: false,
      sources: ctx.events.slice(0, 5).map((e) => ({ type: 'event' as const, id: e.id })),
    });
  }

  if (ctx.emails.length > 0) {
    candidates.push({
      kind: 'digest',
      title: `${ctx.emails.length} unread email${ctx.emails.length === 1 ? '' : 's'} in Primary or Important`,
      reason: 'Unread in the last two days',
      priority: 'low',
      isInferred: false,
      sources: ctx.emails.slice(0, 5).map((e) => ({ type: 'email' as const, id: e.id })),
    });
  }

  // Same checks as model output: caps, grounding, labels.
  const attention = candidates.filter((c) => c.kind !== 'digest').slice(0, MAX_ATTENTION_ITEMS);
  const digest = candidates.filter((c) => c.kind === 'digest');
  return groundItems([...attention, ...digest], ctx).items;
}
