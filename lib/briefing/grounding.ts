// lib/briefing/grounding.ts — server-side checks on generated items
// (BRIEF-003, FR-305..FR-308, SEC-B-014). Pure functions, no I/O.
//
// - An item survives only if it cites ≥ 1 source and every cited (type, id)
//   was fetched by this run. Otherwise it is dropped and counted.
// - Source labels are rebuilt from fetched data; model text never becomes a label.
// - Hedged wording forces isInferred = true.
// - Hard rules: overdue / due-today HIGH+URGENT tasks always appear; at most
//   3 email items, 7 attention items, 5 digest items.
// - suggestedCommand is dropped unless it is a short, non-destructive phrase.
import { floatingDate, type LocalDate } from '@/lib/time';
import type { BriefingContext, TaskFact } from './context';
import {
  MAX_ATTENTION_ITEMS,
  MAX_DIGEST_ITEMS,
  MAX_EMAIL_ITEMS,
  REASON_MAX,
  SUGGESTED_COMMAND_MAX,
  TITLE_MAX,
  type BriefingItem,
  type BriefingItemKind,
  type BriefingItemPriority,
  type BriefingSource,
  type BriefingSourceType,
} from './types';

/** Shape the model is asked to produce (validated by Zod in generate.ts). */
export interface CandidateItem {
  kind: BriefingItemKind;
  title: string;
  reason: string;
  priority: BriefingItemPriority;
  isInferred: boolean;
  sources: { type: BriefingSourceType; id: string }[];
  suggestedCommand?: string | null;
}

export interface GroundingMetrics {
  candidates: number;
  droppedUngrounded: number;
  droppedDuplicate: number;
  droppedOverCap: number;
  forcedAdded: number;
  inferredByHedging: number;
  suggestedCommandsDropped: number;
}

const HEDGING = /\b(likely|probably|seems?|maybe|may|might|possibly|perhaps|apparently|appears?|could be)\b/i;
// Control, zero-width and bidi-override characters.

const UNSAFE_CHARS = new RegExp('[\\u0000-\\u001F\\u007F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2069\\uFEFF]', 'g');
const SAFE_COMMAND_START = /^(move|remind me|draft a reply|draft reply|reply|snooze|reschedule|schedule|plan|review|prepare|follow up)\b/i;
const UNSAFE_COMMAND = /\b(delete|remove|erase|purge|cancel|archive|send|forward|share|password|token|all tasks|every|everything|bulk)\b|https?:|www\.|@/i;

export function cleanText(value: string, max: number): string {
  const text = value.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function sanitizeSuggestedCommand(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const text = cleanText(value, 1_000);
  if (text.length === 0 || text.length > SUGGESTED_COMMAND_MAX) return undefined;
  if (!SAFE_COMMAND_START.test(text) || UNSAFE_COMMAND.test(text)) return undefined;
  return text;
}

export function senderName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]*>\s*$/.exec(from);
  const name = (m ? m[1] : from).trim();
  return name.length > 0 ? name : 'Unknown sender';
}

function hhmmIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function formatDay(date: LocalDate): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(floatingDate(date));
}

/** (type → id → server label) for everything this run fetched. */
export function fetchedIndex(ctx: BriefingContext): Map<BriefingSourceType, Map<string, string>> {
  const idx = new Map<BriefingSourceType, Map<string, string>>([
    ['task', new Map()],
    ['email', new Map()],
    ['event', new Map()],
    ['memory', new Map()],
  ]);
  for (const t of ctx.tasks) idx.get('task')!.set(t.id, cleanText(t.title, 80));
  for (const r of ctx.reminders) if (r.taskId && !idx.get('task')!.has(r.taskId)) idx.get('task')!.set(r.taskId, cleanText(r.title, 80));
  for (const e of ctx.emails) idx.get('email')!.set(e.id, cleanText(`${senderName(e.from)} · ${e.subject}`, 80));
  for (const e of ctx.events) {
    const when = e.allDay ? 'All day' : hhmmIn(e.start, ctx.timeZone);
    idx.get('event')!.set(e.id, cleanText(`${when} ${e.title}`, 80));
  }
  for (const m of ctx.memories) idx.get('memory')!.set(m.id, cleanText(m.content, 60));
  return idx;
}

/** Email items may cite the thread id; normalise to the fetched message id. */
function resolveSourceId(ctx: BriefingContext, type: BriefingSourceType, id: string): string {
  if (type !== 'email') return id;
  const byThread = ctx.emails.find((e) => e.threadId === id && e.id !== id);
  return byThread && !ctx.emails.some((e) => e.id === id) ? byThread.id : id;
}

function priorityLabel(p: number): string | null {
  return p >= 4 ? 'Urgent' : p === 3 ? 'High' : null;
}

/** A purely factual item for a task (used by hard rules and the fallback). */
export function factualTaskItem(t: TaskFact, label: string): Omit<BriefingItem, 'id'> {
  const pr = priorityLabel(t.priority);
  let reason: string;
  switch (t.bucket) {
    case 'overdue':
      reason = `Was due ${t.dueDate ? formatDay(t.dueDate) : 'earlier'}`;
      break;
    case 'today':
      reason = t.dueTime ? `Due today at ${t.dueTime}` : 'Due today';
      break;
    case 'snoozed_waking':
      reason = 'Back from snooze today';
      break;
    default:
      reason = t.dueDate ? `Due ${formatDay(t.dueDate)}` : 'Coming up';
  }
  if (pr) reason += `, marked ${pr}`;
  return {
    kind: 'task',
    title: cleanText(t.title, TITLE_MAX),
    reason: cleanText(reason, REASON_MAX),
    priority: t.priority >= 3 || t.bucket === 'overdue' ? 'high' : t.priority === 2 ? 'medium' : 'low',
    isInferred: false,
    sources: [{ type: 'task', id: t.id, label }],
  };
}

function mustAppear(t: TaskFact): boolean {
  return t.priority >= 3 && (t.bucket === 'overdue' || t.bucket === 'today');
}

export function groundItems(candidates: CandidateItem[], ctx: BriefingContext): { items: BriefingItem[]; metrics: GroundingMetrics } {
  const idx = fetchedIndex(ctx);
  const metrics: GroundingMetrics = {
    candidates: candidates.length,
    droppedUngrounded: 0,
    droppedDuplicate: 0,
    droppedOverCap: 0,
    forcedAdded: 0,
    inferredByHedging: 0,
    suggestedCommandsDropped: 0,
  };

  const grounded: Omit<BriefingItem, 'id'>[] = [];
  const seenSourceSets = new Set<string>();
  for (const c of candidates) {
    const sources: BriefingSource[] = [];
    let ok = Array.isArray(c.sources) && c.sources.length > 0;
    for (const s of c.sources ?? []) {
      const map = idx.get(s.type);
      const id = map ? resolveSourceId(ctx, s.type, s.id) : s.id;
      const label = map?.get(id);
      if (!label) {
        ok = false;
        break;
      }
      if (!sources.some((x) => x.type === s.type && x.id === id)) sources.push({ type: s.type, id, label });
    }
    const title = cleanText(c.title ?? '', TITLE_MAX);
    if (!ok || sources.length === 0 || title.length === 0) {
      metrics.droppedUngrounded++;
      continue;
    }
    const key = `${c.kind}|${sources.map((s) => `${s.type}:${s.id}`).sort().join(',')}`;
    if (seenSourceSets.has(key)) {
      metrics.droppedDuplicate++;
      continue;
    }
    seenSourceSets.add(key);

    const reason = cleanText(c.reason ?? '', REASON_MAX);
    let isInferred = Boolean(c.isInferred);
    if (!isInferred && (HEDGING.test(reason) || HEDGING.test(title))) {
      isInferred = true;
      metrics.inferredByHedging++;
    }
    const suggestedCommand = sanitizeSuggestedCommand(c.suggestedCommand);
    if (c.suggestedCommand && !suggestedCommand) metrics.suggestedCommandsDropped++;
    grounded.push({
      kind: c.kind,
      title,
      reason,
      priority: c.priority,
      isInferred,
      sources: sources.slice(0, 5),
      ...(suggestedCommand ? { suggestedCommand } : {}),
    });
  }

  // Hard rule: HIGH/URGENT overdue or due-today tasks always appear.
  const citedTasks = new Set(grounded.flatMap((i) => i.sources.filter((s) => s.type === 'task').map((s) => s.id)));
  const forced: Omit<BriefingItem, 'id'>[] = [];
  for (const t of ctx.tasks) {
    if (mustAppear(t) && !citedTasks.has(t.id)) {
      forced.push(factualTaskItem(t, idx.get('task')!.get(t.id)!));
      metrics.forcedAdded++;
    }
  }

  const isForcedTask = (i: Omit<BriefingItem, 'id'>) =>
    i.kind !== 'digest' && i.sources.some((s) => s.type === 'task' && ctx.tasks.some((t) => t.id === s.id && mustAppear(t)));

  const attention: Omit<BriefingItem, 'id'>[] = [];
  const digest: Omit<BriefingItem, 'id'>[] = [];
  let emailCount = 0;
  const mustKeep = [...grounded.filter(isForcedTask), ...forced];
  const rest = grounded.filter((i) => !isForcedTask(i));
  for (const i of mustKeep) attention.push(i);
  for (const i of rest) {
    if (i.kind === 'digest') {
      if (digest.length < MAX_DIGEST_ITEMS) digest.push(i);
      else metrics.droppedOverCap++;
      continue;
    }
    if (i.kind === 'email') {
      if (emailCount >= MAX_EMAIL_ITEMS) {
        metrics.droppedOverCap++;
        continue;
      }
      emailCount++;
    }
    if (attention.length < MAX_ATTENTION_ITEMS) attention.push(i);
    else metrics.droppedOverCap++;
  }
  // Keep the model's ranking for everything that was not forced in.
  const order = new Map(grounded.map((g, n) => [g, n]));
  attention.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
  if (attention.length > MAX_ATTENTION_ITEMS) {
    metrics.droppedOverCap += attention.length - MAX_ATTENTION_ITEMS;
    attention.length = MAX_ATTENTION_ITEMS;
  }

  const items = [...attention, ...digest].map((i, n) => ({ id: `i${n + 1}`, ...i }));
  return { items, metrics };
}
