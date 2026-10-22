// lib/briefing/generate.ts — one structured model call per run (FR-315),
// then grounding. Third-party text (email, calendar, memory, task titles
// that may come from email) is passed only inside wrapUntrusted blocks; the
// system prompt is a constant so injected text cannot change instructions.
// If the model fails or returns an invalid object, a deterministic fallback
// is built from the same data (generator = 'fallback').
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { UNTRUSTED_DATA_INSTRUCTIONS, wrapUntrusted } from '@/lib/integrations/untrusted';
import { logger as defaultLogger, type Logger } from '@/lib/observability/logger';
import { formatDay, groundItems, type GroundingMetrics } from './grounding';
import { buildFallbackItems } from './fallback';
import type { BriefingContext } from './context';
import { ITEM_KINDS, ITEM_PRIORITIES, SOURCE_TYPES, type BriefingItem } from './types';

export const BRIEFING_SYSTEM_PROMPT = [
  'You prepare a short morning briefing for one person from data fetched for them.',
  UNTRUSTED_DATA_INSTRUCTIONS,
  'Rules:',
  '- Output at most 7 "needs attention" items (kind task, email, event or reminder) and at most 5 kind "digest" items.',
  '- Every item must cite at least one source by the exact "type" and "id" shown in the data. Never cite an id that is not in the data. Never invent tasks, emails, events, people, dates or numbers.',
  '- title: at most 90 characters. reason: at most 140 characters, stating the fact that puts the item here (e.g. "Due today, marked High").',
  '- isInferred is false only when every claim in title and reason is directly present in the source fields. Anything that interprets intent or importance is isInferred true.',
  '- Overdue or due-today tasks marked High or Urgent always get an item. At most 3 email items. Newsletters and automated mail are not attention items.',
  '- Meetings belong in the schedule, not attention items, unless a task or email references them.',
  '- suggestedCommand is optional: a short command the person could type, such as "Move Finish Q3 report to tomorrow" or "Remind me about the Jordan Lee email after lunch". Never suggest deleting, sending or bulk changes.',
].join('\n');

export const ModelOutputSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(ITEM_KINDS),
        title: z.string().max(300),
        reason: z.string().max(500),
        priority: z.enum(ITEM_PRIORITIES),
        isInferred: z.boolean(),
        sources: z.array(z.object({ type: z.enum(SOURCE_TYPES), id: z.string().max(200) })).max(8),
        suggestedCommand: z.string().max(300).nullable().optional(),
      }),
    )
    .max(20),
});

const PRIORITY_NAMES = ['none', 'low', 'medium', 'high', 'urgent'];

export function buildBriefingPrompt(ctx: BriefingContext): string {
  const tasks = ctx.tasks.map((t) => ({
    type: 'task',
    id: t.id,
    title: t.title,
    bucket: t.bucket,
    priority: PRIORITY_NAMES[t.priority] ?? 'none',
    due: t.dueDate ? `${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}` : null,
    status: t.status,
  }));
  const reminders = ctx.reminders.filter((r) => r.taskId).map((r) => ({ type: 'task', id: r.taskId, reminderTitle: r.title, remindAt: r.at }));
  const emails = ctx.emails.map((e) => ({ type: 'email', id: e.id, from: e.from, subject: e.subject, snippet: e.snippet, receivedAt: e.receivedAt }));
  const events = ctx.events.map((e) => ({ type: 'event', id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, attendees: e.attendeesCount }));
  const memories = ctx.memories.map((m) => ({ type: 'memory', id: m.id, content: m.content }));

  const sections = [
    `Today is ${formatDay(ctx.localDate)} (${ctx.localDate}), time zone ${ctx.timeZone}.`,
    'Tasks (overdue, due today, waking from snooze today, next 3 days):',
    wrapUntrusted('task', tasks, { ref: 'tasks' }),
    'Reminders today (cite the task id):',
    wrapUntrusted('task', reminders, { ref: 'reminders' }),
    'Unread Primary/Important email (metadata and snippet only):',
    wrapUntrusted('gmail', emails, { ref: 'emails' }),
    "Today's calendar events:",
    wrapUntrusted('calendar', events, { ref: 'events' }),
    'Possibly relevant saved memories:',
    wrapUntrusted('memory', memories, { ref: 'memories' }),
    'Produce the briefing items.',
  ];
  return sections.join('\n\n');
}

export interface GenerationResult {
  items: BriefingItem[];
  generator: 'model' | 'fallback';
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  grounding: GroundingMetrics | null;
  fallbackReason?: string;
}

function isEmptyContext(ctx: BriefingContext): boolean {
  return ctx.tasks.length === 0 && ctx.reminders.length === 0 && ctx.emails.length === 0 && ctx.events.length === 0;
}

export async function generateBriefingItems(
  ctx: BriefingContext,
  deps: { model: () => LanguageModel; modelId: string; logger?: Logger; timeoutMs?: number },
): Promise<GenerationResult> {
  const log = deps.logger ?? defaultLogger;
  // Nothing fetched ⇒ nothing to say; no model call, no invention (docs/09 §5 row 16).
  if (isEmptyContext(ctx)) {
    return { items: [], generator: 'model', modelId: null, inputTokens: null, outputTokens: null, grounding: null };
  }
  try {
    const result = await generateObject({
      model: deps.model(),
      schema: ModelOutputSchema,
      schemaName: 'briefing',
      system: BRIEFING_SYSTEM_PROMPT,
      prompt: buildBriefingPrompt(ctx),
      temperature: 0,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(deps.timeoutMs ?? 45_000),
    });
    const { items, metrics } = groundItems(result.object.items, ctx);
    if (metrics.droppedUngrounded > 0) log.warn('briefing.items_dropped_ungrounded', { count: metrics.droppedUngrounded });
    return {
      items,
      generator: 'model',
      modelId: deps.modelId,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      grounding: metrics,
    };
  } catch (err) {
    const reason = err instanceof Error && /^[A-Za-z_]{1,64}$/.test(err.name) ? err.name : 'UnknownError';
    log.warn('briefing.model_failed_using_fallback', { errorName: reason });
    return {
      items: buildFallbackItems(ctx),
      generator: 'fallback',
      modelId: null,
      inputTokens: null,
      outputTokens: null,
      grounding: null,
      fallbackReason: reason,
    };
  }
}
