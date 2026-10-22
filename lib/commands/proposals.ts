// lib/commands/proposals.ts — turns a propose-tool call into a clarification,
// a stored proposal awaiting confirmation, or an auto-executed action
// (docs/04 §3 steps 5–11, §8).
//
// A Draft is the partially-resolved, JSON-serialisable form of a propose
// call: task references are ids (or a candidate set), dates are the user's
// phrases until resolved. processDraft() is shared by the propose tools and
// by the clarification handler, which fills one open slot from the option
// the user picked and resumes here without calling the model.
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@/lib/generated/prisma/client';
import { findProjectByName } from '@/lib/projects/repo';
import {
  NotFoundError,
  OPEN_STATUSES,
  PRIORITY,
  getTask,
  listTasks,
  previewBulkUpdate,
  searchTasks,
  ValidationError,
  type Task,
  type TaskFilter,
} from '@/lib/tasks/repo';
import { floatingDate } from '@/lib/time';
import { executeProposal } from './execute';
import { dateLabel, instantLabel, resolveDatePhrase, resolveDateRange, type DateNote, type Purpose } from './dates';
import { decide } from './policy';
import { PROPOSAL_TTL_MS, createProposal } from './repo';
import { classifyRisk, KIND_TOOL, type ProposalKind } from './risk';
import type { RunState } from './run-state';
import { dueLabel, optionDetail, PRIORITY_NAMES, type PriorityName } from './summaries';
import type { ClarificationOption, DiffLine, ProposalResult, ProposalView, Risk, TaintSource } from './types';

export const MAX_AHEAD_MS = 365 * 86_400_000;

export interface ResolvedDate {
  instant: string;
  hasTime: boolean;
  localDate: string;
  label: string;
  note?: DateNote;
}

export type DateField = { phrase: string } | { resolved: ResolvedDate } | { none: true };

export interface EmailRef {
  messageId: string;
  threadId?: string;
  from: string;
  subject: string;
}

export interface Draft {
  kind: ProposalKind | 'resolve';
  target?: { taskId: string } | { taskIds: string[]; reason: 'ambiguous' | 'no_antecedent' };
  /** Kind-specific non-date fields (title, priority, content, body, selector…). */
  fields: Record<string, unknown>;
  /** Date phrases keyed by field ('due', 'start', 'until', 'at', 'change.due'). */
  dates: Record<string, DateField>;
  email?: EmailRef;
  tainted: boolean;
  taintSources: TaintSource[];
  /** 'resolve' drafts: the reference to pin and the command to re-run. */
  reference?: string;
  originalInput?: string;
}

export interface StoredOption extends ClarificationOption {
  value: unknown;
}

export interface ClarificationArgs {
  draft: Draft;
  slot: string;
  question: string;
  message: string;
  options: StoredOption[];
  allowFreeText: boolean;
  originalInput: string;
}

const PURPOSE: Record<string, Purpose> = { due: 'due', start: 'start', until: 'snooze', at: 'remind', 'change.due': 'due' };
const FIELD_QUESTION: Record<string, string> = {
  due: 'When should it be due?',
  start: 'When should it start?',
  until: 'Until when?',
  at: 'When should I remind you?',
  'change.due': 'When should they be due?',
};
const LUNCH_OPTIONS = ['12:30', '13:00', '13:30', '14:00'];

// ───────────────────────── helpers ─────────────────────────

function q(title: string): string {
  return `"${title.length > 80 ? `${title.slice(0, 79)}…` : title}"`;
}

/** dueAt storage form: timed → instant; date-only → floating 00:00Z (docs/03 §1). */
function dueStorage(d: ResolvedDate): { dueAt: string; dueHasTime: boolean } {
  return d.hasTime ? { dueAt: d.instant, dueHasTime: true } : { dueAt: floatingDate(d.localDate).toISOString(), dueHasTime: false };
}

function resolvedDate(f: DateField | undefined): ResolvedDate | null | undefined {
  if (!f) return undefined;
  if ('none' in f) return null;
  if ('resolved' in f) return f.resolved;
  return undefined;
}

function priorityValue(name: unknown): number | undefined {
  return typeof name === 'string' && name in PRIORITY ? PRIORITY[name as PriorityName] : undefined;
}

const RRULES: [RegExp, string][] = [
  [/^(daily|every ?day)$/, 'FREQ=DAILY'],
  [/^(every weekday|weekdays|every work ?day)$/, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  [/^(weekly|every week)$/, 'FREQ=WEEKLY'],
  [/^(monthly|every month)$/, 'FREQ=MONTHLY'],
  [/^(yearly|annually|every year)$/, 'FREQ=YEARLY'],
];
const BYDAY: Record<string, string> = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' };

export function recurrenceToRRule(phrase: string): string | null {
  const p = phrase.toLowerCase().trim();
  for (const [re, rule] of RRULES) if (re.test(p)) return rule;
  const m = /^every ((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:(?:,| and | & |, and )(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)*)$/.exec(p);
  if (m) {
    const days = m[1].split(/,| and | & /).map((d) => BYDAY[d.trim().slice(0, 3)]).filter(Boolean);
    if (days.length) return `FREQ=WEEKLY;BYDAY=${[...new Set(days)].join(',')}`;
  }
  return null;
}

function optionsFrom<T>(items: T[], make: (t: T, i: number) => Promise<StoredOption> | StoredOption): Promise<StoredOption[]> {
  return Promise.all(items.slice(0, 5).map((t, i) => make(t, i)));
}

async function clarify(state: RunState, draft: Draft, c: Omit<ClarificationArgs, 'draft' | 'originalInput'>): Promise<ProposalResult> {
  const args: ClarificationArgs = { ...c, draft, originalInput: draft.originalInput ?? state.input };
  const row = await createProposal(state.userId, {
    agentRunId: state.runId,
    kind: draft.kind,
    args: args as unknown as Prisma.InputJsonValue,
    summary: c.question,
    risk: draft.kind === 'resolve' ? 'READ' : classifyRisk({ kind: draft.kind, targetCount: 1 }),
    tainted: draft.tainted,
    untrustedSources: draft.taintSources,
    status: 'NEEDS_CLARIFICATION',
    expiresAt: new Date(state.now.getTime() + PROPOSAL_TTL_MS),
  });
  const options = c.options.map(({ id, label, detail }) => ({ id, label, ...(detail ? { detail } : {}) }));
  // One clarification per turn: only the first is shown.
  if (!state.outcomes.some((o) => o.kind === 'clarification')) {
    state.outcomes.push({ kind: 'clarification', proposalId: row.id, message: c.message, question: c.question, options, allowFreeText: c.allowFreeText });
  }
  return { status: 'needs_clarification', question: c.question, options };
}

function reject(state: RunState, code: string, message: string, policy = false): ProposalResult {
  state.outcomes.push({ kind: 'rejected', code, message, policy });
  return { status: 'rejected', code, message };
}

/** Verb phrase for "Which task should …?" */
function actionPhrase(draft: Draft): string {
  const due = resolvedDate(draft.dates.due);
  switch (draft.kind) {
    case 'task.update':
      return due ? `move to ${due.label}` : due === null ? 'lose its due date' : 'change';
    case 'task.complete':
      return 'be marked done';
    case 'task.reopen':
      return 'be reopened';
    case 'task.delete':
      return 'be deleted';
    case 'task.snooze': {
      const until = resolvedDate(draft.dates.until);
      return until ? `be snoozed until ${until.label}` : 'be snoozed';
    }
    case 'reminder.create': {
      const at = resolvedDate(draft.dates.at);
      return at ? `get a reminder at ${at.label}` : 'get the reminder';
    }
    default:
      return 'change';
  }
}

// ───────────────────────── slots ─────────────────────────

/** Resolves every date phrase it can; returns a clarification for the first one it can't. */
async function resolveDates(state: RunState, draft: Draft): Promise<ProposalResult | null> {
  for (const [key, field] of Object.entries(draft.dates)) {
    if (!('phrase' in field)) continue;
    const purpose = PURPOSE[key] ?? 'due';
    const r = resolveDatePhrase({ phrase: field.phrase, now: state.now, prefs: state.prefs, purpose });
    const slot = `date:${key}`;
    switch (r.status) {
      case 'resolved':
        draft.dates[key] = { resolved: { instant: r.instant, hasTime: r.hasTime, localDate: r.localDate, label: r.label, ...(r.note ? { note: r.note } : {}) } };
        break;
      case 'ambiguous':
        return clarify(state, draft, {
          slot,
          question: 'Which date?',
          message: `"${field.phrase}" could mean ${r.candidates.map((c) => c.label).join(' or ')}. Which one?`,
          options: r.candidates.slice(0, 5).map((c, i) => ({ id: `opt_${i + 1}`, label: c.label, value: c })),
          allowFreeText: true,
        });
      case 'past':
        return clarify(state, draft, {
          slot,
          question: `That's in the past — did you mean ${r.suggestion.label}?`,
          message: `${r.label} has already passed. Did you mean ${r.suggestion.label}?`,
          options: [{ id: 'opt_1', label: r.suggestion.label, value: r.suggestion }],
          allowFreeText: true,
        });
      case 'needs_preference':
        return clarify(state, draft, {
          slot: `pref:lunchEndsAt:${key}`,
          question: r.question,
          message: r.question,
          options: LUNCH_OPTIONS.map((t, i) => ({ id: `opt_${i + 1}`, label: t, value: t })),
          allowFreeText: true,
        });
      case 'unparseable': {
        const question = FIELD_QUESTION[key] ?? 'When?';
        return clarify(state, draft, { slot, question, message: `I couldn't work out "${field.phrase}". ${question}`, options: [], allowFreeText: true });
      }
    }
  }
  return null;
}

async function clarifyTask(state: RunState, draft: Draft, taskIds: string[], reason: 'ambiguous' | 'no_antecedent'): Promise<ProposalResult> {
  const tasks: Task[] = [];
  for (const id of taskIds.slice(0, 5)) {
    try {
      tasks.push(await getTask(state.userId, id));
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  if (tasks.length === 0) return reject(state, 'NO_MATCH', "I couldn't find that task.");
  const action = actionPhrase(draft);
  const sameTitle = tasks.length > 1 && tasks.every((t) => t.title.toLowerCase() === tasks[0].title.toLowerCase());
  const message =
    reason === 'ambiguous' && sameTitle
      ? `You have ${tasks.length} tasks called ${q(tasks[0].title)}. Which one should ${action}?`
      : `Which task should ${action}?`;
  return clarify(state, draft, {
    slot: 'task',
    question: 'Which task?',
    message,
    options: await optionsFrom(tasks, async (t, i) => ({ id: `opt_${i + 1}`, label: t.title, detail: await optionDetail(state, t), value: t.id })),
    allowFreeText: true,
  });
}

// ───────────────────────── per-kind preparation ─────────────────────────

interface Prepared {
  id?: string;
  args: Record<string, unknown>;
  summary: string;
  diff: DiffLine[];
  targetIds: string[];
  targetVersions: Record<string, number>;
  clearsContent?: boolean;
  recipientCount?: number;
  inferredFields: string[];
}

type PrepareResult = Prepared | { reject: { code: string; message: string; policy?: boolean } };

function inferred(...dates: (ResolvedDate | null | undefined)[]): string[] {
  return dates.filter((d): d is ResolvedDate => Boolean(d?.note)).map((d) => d.note!);
}

function futureCheck(d: ResolvedDate, now: Date): { code: string; message: string } | null {
  const t = new Date(d.instant).getTime();
  if (t <= now.getTime()) return { code: 'PAST', message: `${d.label} has already passed.` };
  if (t - now.getTime() > MAX_AHEAD_MS) return { code: 'TOO_FAR', message: 'That is more than a year ahead.' };
  return null;
}

async function loadTarget(state: RunState, draft: Draft): Promise<Task | { reject: { code: string; message: string } }> {
  const target = draft.target;
  if (!target || !('taskId' in target)) return { reject: { code: 'NO_MATCH', message: "I couldn't find that task." } };
  try {
    return await getTask(state.userId, target.taskId);
  } catch (e) {
    if (e instanceof NotFoundError) return { reject: { code: 'NO_MATCH', message: "I couldn't find that task." } };
    throw e;
  }
}

async function projectId(state: RunState, name: unknown): Promise<string | null | undefined | { reject: { code: string; message: string } }> {
  if (name === undefined) return undefined;
  if (name === 'none') return null;
  const project = await findProjectByName(state.userId, String(name));
  if (!project) return { reject: { code: 'PROJECT_NOT_FOUND', message: `You don't have a project called "${String(name)}".` } };
  return project.id;
}

async function prepare(state: RunState, draft: Draft): Promise<PrepareResult> {
  const f = draft.fields;
  const tz = state.prefs.timeZone;
  switch (draft.kind) {
    case 'task.create': {
      const title = String(f.title ?? '').trim();
      if (!title) return { reject: { code: 'TITLE_REQUIRED', message: 'What should the task be called?' } };
      const due = resolvedDate(draft.dates.due);
      const start = resolvedDate(draft.dates.start);
      const pid = await projectId(state, f.project);
      if (pid && typeof pid === 'object') return pid;
      let recurrenceRule: string | undefined;
      if (typeof f.recurrence === 'string') {
        const rule = recurrenceToRRule(f.recurrence);
        if (!rule) return { reject: { code: 'RECURRENCE_UNSUPPORTED', message: `I can't repeat a task "${f.recurrence}" yet.` } };
        if (!due) return { reject: { code: 'RECURRENCE_NEEDS_DUE', message: 'A repeating task needs a first due date.' } };
        recurrenceRule = rule;
      }
      const args: Record<string, unknown> = {
        title,
        timeZone: tz,
        ...(due ? dueStorage(due) : {}),
        ...(start ? { startAt: start.instant } : {}),
        ...(priorityValue(f.priority) !== undefined ? { priority: priorityValue(f.priority) } : {}),
        ...(typeof pid === 'string' ? { projectId: pid } : {}),
        ...(Array.isArray(f.tags) ? { tags: f.tags } : {}),
        ...(typeof f.description === 'string' ? { description: f.description } : {}),
        ...(typeof f.estimateMinutes === 'number' ? { estimateMinutes: f.estimateMinutes } : {}),
        ...(recurrenceRule ? { recurrenceRule } : {}),
      };
      const diff: DiffLine[] = [{ entity: title, field: 'task', before: null, after: 'new' }];
      if (due) diff.push({ entity: title, field: 'due', before: null, after: due.label });
      if (start) diff.push({ entity: title, field: 'start', before: null, after: start.label });
      if (f.project !== undefined) diff.push({ entity: title, field: 'project', before: null, after: String(f.project) });
      if (recurrenceRule) diff.push({ entity: title, field: 'repeats', before: null, after: String(f.recurrence) });
      return {
        args,
        summary: `Add ${q(title)}${due ? ` due ${due.label}` : ''}`,
        diff,
        targetIds: [],
        targetVersions: {},
        inferredFields: inferred(due, start),
      };
    }
    case 'task.update': {
      const task = await loadTarget(state, draft);
      if ('reject' in task) return task;
      const patch: Record<string, unknown> = {};
      const diff: DiffLine[] = [];
      let clears = false;
      const due = resolvedDate(draft.dates.due);
      const start = resolvedDate(draft.dates.start);
      if (due !== undefined) {
        if (due === null) {
          if (task.dueAt) clears = true;
          Object.assign(patch, { dueAt: null, dueHasTime: false });
        } else Object.assign(patch, dueStorage(due));
        diff.push({ entity: task.title, field: 'due', before: dueLabel(task, state), after: due?.label ?? null });
      }
      if (start !== undefined) {
        patch.startAt = start?.instant ?? null;
        diff.push({ entity: task.title, field: 'start', before: task.startAt ? instantLabel(task.startAt, tz, state.now) : null, after: start?.label ?? null });
      }
      if (typeof f.title === 'string' && f.title.trim() !== task.title) {
        patch.title = f.title.trim();
        diff.push({ entity: task.title, field: 'title', before: task.title, after: f.title.trim() });
      }
      if (typeof f.description === 'string') {
        if (!f.description.trim() && task.description) clears = true;
        patch.description = f.description.trim() ? f.description : null;
        diff.push({ entity: task.title, field: 'description', before: task.description, after: f.description || null });
      }
      const pr = priorityValue(f.priority);
      if (pr !== undefined && pr !== task.priority) {
        patch.priority = pr;
        diff.push({ entity: task.title, field: 'priority', before: PRIORITY_NAMES[task.priority], after: String(f.priority) });
      }
      const pid = await projectId(state, f.project);
      if (pid && typeof pid === 'object') return pid;
      if (pid !== undefined) {
        patch.projectId = pid;
        diff.push({ entity: task.title, field: 'project', before: null, after: f.project === 'none' ? null : String(f.project) });
      }
      if (Array.isArray(f.addTags) || Array.isArray(f.removeTags)) {
        const remove = new Set(((f.removeTags as string[]) ?? []).map((t) => t.toLowerCase()));
        const tags = [...new Set([...task.tags, ...((f.addTags as string[]) ?? []).map((t) => t.toLowerCase())])].filter((t) => !remove.has(t));
        patch.tags = tags;
        diff.push({ entity: task.title, field: 'tags', before: task.tags.join(', ') || null, after: tags.join(', ') || null });
      }
      if (typeof f.estimateMinutes === 'number') {
        patch.estimateMinutes = f.estimateMinutes;
        diff.push({ entity: task.title, field: 'estimate', before: task.estimateMinutes ? `${task.estimateMinutes} min` : null, after: `${f.estimateMinutes} min` });
      }
      if (Object.keys(patch).length === 0) return { reject: { code: 'NO_CHANGE', message: `${q(task.title)} already looks like that.` } };
      const onlyDue = diff.length === 1 && diff[0].field === 'due';
      return {
        args: { taskId: task.id, expectedVersion: task.version, patch },
        summary: onlyDue ? (due ? `Move ${q(task.title)} to ${due.label}` : `Remove the due date from ${q(task.title)}`) : `Update ${q(task.title)}`,
        diff,
        targetIds: [task.id],
        targetVersions: { [task.id]: task.version },
        clearsContent: clears,
        inferredFields: inferred(due, start),
      };
    }
    case 'task.complete':
    case 'task.reopen':
    case 'task.delete': {
      const task = await loadTarget(state, draft);
      if ('reject' in task) return task;
      const verb = draft.kind === 'task.complete' ? 'Complete' : draft.kind === 'task.reopen' ? 'Reopen' : 'Delete';
      const after = draft.kind === 'task.complete' ? 'DONE' : draft.kind === 'task.reopen' ? 'TODO' : 'deleted';
      return {
        args: { taskId: task.id, expectedVersion: task.version },
        summary: `${verb} ${q(task.title)}`,
        diff: [{ entity: task.title, field: draft.kind === 'task.delete' ? 'task' : 'status', before: draft.kind === 'task.delete' ? 'exists' : task.status, after }],
        targetIds: [task.id],
        targetVersions: { [task.id]: task.version },
        inferredFields: [],
      };
    }
    case 'task.snooze': {
      const task = await loadTarget(state, draft);
      if ('reject' in task) return task;
      const until = resolvedDate(draft.dates.until);
      if (!until) return { reject: { code: 'DATE_REQUIRED', message: 'Until when?' } };
      const bad = futureCheck(until, state.now);
      if (bad) return { reject: bad };
      return {
        args: { taskId: task.id, expectedVersion: task.version, until: until.instant },
        summary: `Snooze ${q(task.title)} until ${until.label}`,
        diff: [{ entity: task.title, field: 'snoozed until', before: task.snoozedUntil ? instantLabel(task.snoozedUntil, tz, state.now) : null, after: until.label }],
        targetIds: [task.id],
        targetVersions: { [task.id]: task.version },
        inferredFields: inferred(until),
      };
    }
    case 'reminder.create': {
      let task: Task | null = null;
      if (draft.target) {
        const t = await loadTarget(state, draft);
        if ('reject' in t) return t;
        task = t;
      }
      const title = task?.title ?? (typeof f.title === 'string' ? f.title.trim() : '');
      if (!title) return { reject: { code: 'TITLE_REQUIRED', message: 'What should I remind you about?' } };
      const at = resolvedDate(draft.dates.at);
      if (!at) return { reject: { code: 'DATE_REQUIRED', message: 'When should I remind you?' } };
      const bad = futureCheck(at, state.now);
      if (bad) return { reject: bad };
      return {
        args: { ...(task ? { taskId: task.id } : { title }), remindAt: at.instant },
        summary: `Remind you at ${at.label}: ${q(title)}`,
        diff: [{ entity: title, field: 'reminder', before: null, after: at.label }],
        targetIds: task ? [task.id] : [],
        targetVersions: task ? { [task.id]: task.version } : {},
        inferredFields: inferred(at),
      };
    }
    case 'task.bulk':
      return prepareBulk(state, draft);
    case 'memory.save': {
      const content = String(f.content ?? '').trim();
      if (!content) return { reject: { code: 'CONTENT_REQUIRED', message: 'What should I remember?' } };
      return {
        args: { content },
        summary: `Remember: ${q(content)}`,
        diff: [{ entity: 'memory', field: 'content', before: null, after: content }],
        targetIds: [],
        targetVersions: {},
        inferredFields: [],
      };
    }
    case 'email.draft':
      return prepareDraft(state, draft);
    case 'resolve':
      return { reject: { code: 'UNSUPPORTED', message: 'Nothing to do.' } };
  }
}

async function prepareBulk(state: RunState, draft: Draft): Promise<PrepareResult> {
  const selector = (draft.fields.selector ?? {}) as { query?: string; due?: string; project?: string; priority?: string; status?: 'open' };
  const change = (draft.fields.change ?? {}) as { status?: 'DONE'; addTags?: string[]; priority?: string };
  const tz = state.prefs.timeZone;
  const filter: TaskFilter = { status: [...OPEN_STATUSES] };
  const pr = priorityValue(selector.priority);
  if (pr !== undefined) filter.priority = [pr];
  if (selector.project) {
    const pid = await projectId(state, selector.project);
    if (pid && typeof pid === 'object') return pid;
    if (typeof pid === 'string') filter.projectId = pid;
  }
  const opts = { filter, limit: 51, now: state.now, timeZone: tz };
  let tasks: Task[];
  let scope = 'open tasks';
  const due = selector.due?.toLowerCase().trim();
  if (due === 'overdue') {
    tasks = (await listTasks(state.userId, { kind: 'overdue' }, opts)).items.map((i) => i.task);
    scope = 'overdue tasks';
  } else if (due === 'today' && !selector.query) {
    tasks = (await listTasks(state.userId, { kind: 'today' }, opts)).items.map((i) => i.task);
    scope = 'tasks due today';
  } else {
    if (due) {
      const range = resolveDateRange({ phrase: due, now: state.now, prefs: state.prefs, maxDays: 366 });
      if (range.status !== 'resolved') return { reject: { code: 'DATE_UNCLEAR', message: `I couldn't work out "${selector.due}".` } };
      filter.dueOn = { from: range.startDate, toExclusive: range.endDate, timeZone: tz };
      scope = `tasks due ${range.label.toLowerCase()}`;
    }
    tasks = selector.query
      ? (await searchTasks(state.userId, { ...opts, text: selector.query })).items.map((i) => i.task)
      : (await listTasks(state.userId, { kind: 'all' }, opts)).items.map((i) => i.task);
  }
  tasks = tasks.filter((t) => (OPEN_STATUSES as readonly string[]).includes(t.status) && (pr === undefined || t.priority === pr));
  if (tasks.length > 50) return { reject: { code: 'BULK_LIMIT', message: 'I can change at most 50 tasks at once.', policy: true } };
  if (tasks.length === 0) return { reject: { code: 'NO_MATCH', message: `You don't have any ${scope} that match.` } };

  const newDue = resolvedDate(draft.dates['change.due']);
  const bulkChange: Record<string, unknown> = {};
  if (newDue) Object.assign(bulkChange, dueStorage(newDue));
  if (change.status === 'DONE') bulkChange.complete = true;
  const cpr = priorityValue(change.priority);
  if (cpr !== undefined) bulkChange.priority = cpr;
  if (change.addTags?.length) bulkChange.addTags = change.addTags.map((t) => t.toLowerCase());
  if (Object.keys(bulkChange).length === 0) return { reject: { code: 'NO_CHANGE', message: 'What should change?' } };

  let preview;
  try {
    preview = await previewBulkUpdate(
      state.userId,
      { ids: tasks.map((t) => t.id) },
      {
        ...(bulkChange.dueAt ? { dueAt: new Date(bulkChange.dueAt as string), dueHasTime: bulkChange.dueHasTime as boolean } : {}),
        ...(bulkChange.complete ? { complete: true as const } : {}),
        ...(cpr !== undefined ? { priority: cpr } : {}),
        ...(bulkChange.addTags ? { addTags: bulkChange.addTags as string[] } : {}),
      },
      { now: state.now, timeZone: tz, max: 50 },
    );
  } catch (e) {
    if (e instanceof ValidationError) return { reject: { code: e.reason, message: e.message, policy: e.reason === 'BULK_LIMIT' } };
    throw e;
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const diff: DiffLine[] = preview.targets.slice(0, 10).map((t) => {
    const task = byId.get(t.id)!;
    if (newDue) return { entity: t.title, field: 'due', before: dueLabel(task, state), after: newDue.label };
    if (bulkChange.complete) return { entity: t.title, field: 'status', before: task.status, after: 'DONE' };
    if (cpr !== undefined) return { entity: t.title, field: 'priority', before: PRIORITY_NAMES[task.priority], after: String(change.priority) };
    return { entity: t.title, field: 'tags', before: task.tags.join(', ') || null, after: String(bulkChange.addTags) };
  });
  const what = newDue ? `to ${newDue.label}` : bulkChange.complete ? 'to done' : 'in bulk';
  return {
    args: { expected: preview.expected, change: bulkChange },
    summary: `${newDue ? 'Move' : bulkChange.complete ? 'Complete' : 'Update'} ${preview.count} ${preview.count === 1 ? 'task' : 'tasks'}${newDue || bulkChange.complete ? ` ${what}` : ''}`,
    diff,
    targetIds: preview.expected.map((e) => e.id),
    targetVersions: Object.fromEntries(preview.expected.map((e) => [e.id, e.version])),
    inferredFields: inferred(newDue),
  };
}

function addressOf(from: string): string | null {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(from) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(from);
  return m ? m[1].toLowerCase() : null;
}

async function prepareDraft(state: RunState, draft: Draft): Promise<PrepareResult> {
  if (state.googleStatus === 'none') {
    state.needsReconnect = true;
    return { reject: { code: 'INTEGRATION_RECONNECT_REQUIRED', message: 'Connect Google in Settings to create Gmail drafts.' } };
  }
  const f = draft.fields;
  const email = draft.email;
  const explicitTo = Array.isArray(f.to) ? (f.to as string[]).map((a) => a.trim().toLowerCase()) : [];
  const sender = email ? addressOf(email.from) : null;
  const to = explicitTo.length ? explicitTo : sender ? [sender] : [];
  if (to.length === 0) return { reject: { code: 'RECIPIENT_REQUIRED', message: 'Who should the email go to?' } };
  const subject =
    typeof f.subject === 'string' && f.subject.trim()
      ? f.subject.trim()
      : email
        ? /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`
        : '';
  if (!subject) return { reject: { code: 'SUBJECT_REQUIRED', message: 'What should the subject be?' } };
  const body = String(f.body ?? '');
  // Recipients neither named by the user nor the sender being replied to are flagged.
  const flagged = to.filter((a) => a !== sender && !state.input.toLowerCase().includes(a));
  const id = `p${randomBytes(12).toString('hex')}`;
  const diff: DiffLine[] = [
    ...to.map((a) => ({ entity: 'email', field: flagged.includes(a) ? 'to (not named by you)' : 'to', before: null, after: a })),
    { entity: 'email', field: 'subject', before: null, after: subject },
    { entity: 'email', field: 'body', before: null, after: body },
  ];
  return {
    id,
    args: {
      to,
      subject,
      body,
      messageIdHeader: `<${id}@personal-os.app>`,
      ...(email ? { inReplyToMessageId: email.messageId, ...(email.threadId ? { threadId: email.threadId } : {}) } : {}),
    },
    summary: `Draft an email to ${to.join(', ')}: ${q(subject)}`,
    diff,
    targetIds: [],
    targetVersions: {},
    recipientCount: to.length,
    inferredFields: [],
  };
}

// ───────────────────────── main entry ─────────────────────────

export async function processDraft(state: RunState, draft: Draft): Promise<ProposalResult> {
  if (draft.kind === 'resolve') return reject(state, 'UNSUPPORTED', 'Nothing to do.');
  const kind = draft.kind;

  // Resolve dates first so the task question can name the new date.
  const dateFirst = { ...draft, dates: { ...draft.dates } };
  for (const [key, field] of Object.entries(dateFirst.dates)) {
    if ('phrase' in field) {
      const r = resolveDatePhrase({ phrase: field.phrase, now: state.now, prefs: state.prefs, purpose: PURPOSE[key] ?? 'due' });
      if (r.status === 'resolved') dateFirst.dates[key] = { resolved: { instant: r.instant, hasTime: r.hasTime, localDate: r.localDate, label: r.label, ...(r.note ? { note: r.note } : {}) } };
    }
  }
  if (draft.target && 'taskIds' in draft.target) return clarifyTask(state, dateFirst, draft.target.taskIds, draft.target.reason);

  const dateClarification = await resolveDates(state, draft);
  if (dateClarification) return dateClarification;

  const prepared = await prepare(state, draft);
  if ('reject' in prepared) return reject(state, prepared.reject.code, prepared.reject.message, prepared.reject.policy ?? false);

  const risk: Risk = classifyRisk({ kind, targetCount: prepared.targetIds.length, clearsContent: prepared.clearsContent });
  const decision = decide({
    risk,
    targetCount: kind === 'reminder.create' ? 0 : prepared.targetIds.length,
    tainted: draft.tainted,
    resolution: draft.target ? 'unique' : 'not_applicable',
    inferredFields: prepared.inferredFields,
    recipientCount: prepared.recipientCount,
  });
  if (decision.decision === 'reject') return reject(state, decision.code, decision.message, true);

  const requiresConfirmation = decision.decision === 'confirm';
  const expiresAt = new Date(state.now.getTime() + PROPOSAL_TTL_MS);
  const row = await createProposal(state.userId, {
    ...(prepared.id ? { id: prepared.id } : {}),
    agentRunId: state.runId,
    kind,
    args: prepared.args as Prisma.InputJsonValue,
    summary: prepared.summary,
    diff: prepared.diff as unknown as Prisma.InputJsonValue,
    risk,
    targetIds: prepared.targetIds,
    targetVersions: prepared.targetVersions,
    tainted: draft.tainted,
    untrustedSources: draft.taintSources,
    requiresConfirmation,
    confirmationReason: decision.reasons.join(',') || null,
    status: 'PENDING',
    expiresAt,
  });

  if (requiresConfirmation) {
    const view: ProposalView = {
      id: row.id,
      tool: KIND_TOOL[kind],
      risk,
      summary: prepared.summary,
      diff: prepared.diff,
      reasons: decision.reasons,
      ...(draft.tainted ? { taintSources: draft.taintSources } : {}),
      expiresAt: expiresAt.toISOString(),
    };
    state.outcomes.push({ kind: 'proposal', proposal: view });
    return { status: 'requires_confirmation', proposalId: row.id, summary: prepared.summary, reasons: decision.reasons };
  }

  const result = await executeProposal(state.userId, row.id, { deps: state.deps, source: state.source, requestId: state.requestId });
  if (!result.ok) {
    const message = result.code === 'CONFLICT' ? 'That task changed while I was working — ask again.' : (result.message ?? 'That could not be done.');
    return reject(state, result.code, message, result.code === 'POLICY_REJECTED');
  }
  state.outcomes.push({ kind: 'executed', proposalId: row.id, action: result.action });
  return { status: 'executed', proposalId: row.id, summary: prepared.summary };
}
