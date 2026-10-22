// lib/ai/tools/index.ts — the tool registry the model sees (docs/04 §5).
//
// Read tools return data (third-party text inside untrusted-data blocks);
// propose tools return a ProposalResult. Nothing here gives the model the
// database, ids or authority: userId comes from the run, entities are
// run-scoped handles, dates are the user's phrases, and every mutation goes
// through lib/commands/proposals (policy, confirmation, execution).
import { logger } from '@/lib/observability/logger';
import { createHash } from 'node:crypto';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { wrapUntrusted, type UntrustedSource } from '@/lib/integrations/untrusted';
import { searchMemories } from '@/lib/memory/repo';
import { getPreferences } from '@/lib/preferences/repo';
import { NotFoundError, OPEN_STATUSES, getTask, listSubtasks, listTasks, searchTasks, type Task, type TaskFilter } from '@/lib/tasks/repo';
import { localDateOf } from '@/lib/time';
import { instantLabel, ISO_INSTANT, resolveDateRange } from '@/lib/commands/dates';
import { toolErrorFor } from '@/lib/commands/errors';
import { processDraft, type Draft, type EmailRef } from '@/lib/commands/proposals';
import { recordToolCall } from '@/lib/commands/repo';
import { resolveTaskReference } from '@/lib/commands/resolve-task';
import { TOOL_KIND, type ProposalKind } from '@/lib/commands/risk';
import { HANDLE_RE, issueHandle, issueSetHandle, untrustedStrings, type RunState } from '@/lib/commands/run-state';
import { summarizeTask, type TaskSummary } from '@/lib/commands/summaries';
import type { ProposalResult, TaintSource, ToolErrorCode } from '@/lib/commands/types';
import { MAX_RUN_OUTPUT_BYTES, byteLength, capString, fitList } from './cap';

// ───────────────────────── common schema fragments (§5) ─────────────────────────

const Handle = z.string().regex(HANDLE_RE, 'must be a handle issued by a tool in this run');
const DatePhrase = z
  .string()
  .min(1)
  .max(80)
  .refine((s) => !ISO_INSTANT.test(s.trim()), "pass the user's own words, never an ISO timestamp");
const Title = z.string().trim().min(1).max(200);
const Description = z.string().max(5000);
const Priority = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const Tag = z.string().trim().min(1).max(30);

export const READ_TOOLS = [
  'search_tasks',
  'get_task',
  'resolve_task',
  'list_agenda',
  'list_calendar_events',
  'search_email',
  'get_email',
  'search_memory',
  'search_web',
  'get_preferences',
] as const;
export const PROPOSE_TOOLS = Object.keys(TOOL_KIND);

const TIMEOUT_MS: Record<string, number> = {
  search_tasks: 2000,
  get_task: 2000,
  resolve_task: 2000,
  list_agenda: 6000,
  list_calendar_events: 5000,
  search_email: 6000,
  get_email: 5000,
  search_memory: 4000,
  search_web: 8000,
  get_preferences: 1000,
  propose_bulk_update_tasks: 8000,
  propose_email_draft: 8000,
  save_memory: 5000,
};

type ToolError = { error: ToolErrorCode; message?: string };
const err = (error: ToolErrorCode, message?: string): ToolError => ({ error, ...(message ? { message } : {}) });

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** What goes into AgentAction.input: no email bodies, memory content or raw queries of email. */
function auditInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case 'search_email':
      return { queryHash: hash(String(input.query ?? '')), limit: input.limit };
    case 'propose_email_draft':
      return { replyTo: input.replyTo, recipients: Array.isArray(input.to) ? input.to.length : 0, bodyHash: hash(String(input.body ?? '')), bodyLength: String(input.body ?? '').length };
    case 'save_memory':
      return { contentLength: String(input.content ?? '').length };
    default:
      return input;
  }
}

class ToolTimeout extends Error {}

function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ───────────────────────── shared helpers ─────────────────────────

function wrap(state: RunState, source: UntrustedSource, taint: TaintSource | null, content: unknown, ref?: string): string {
  if (taint) state.taint.add(taint);
  return wrapUntrusted(source, content, { ref });
}

async function summaries(state: RunState, tasks: Task[]): Promise<{ list: TaskSummary[]; fromEmail: boolean }> {
  const list = await Promise.all(tasks.map((t) => summarizeTask(state, t)));
  return { list, fromEmail: tasks.some((t) => t.source === 'EMAIL') };
}

function taskListOutput(state: RunState, list: TaskSummary[], fromEmail: boolean, extra: Record<string, unknown> = {}, totalCount = list.length): string | object {
  const render = (items: TaskSummary[], truncated: boolean) => JSON.stringify({ ...extra, tasks: items, truncated, totalCount });
  const out = fitList(list, render);
  // Titles of tasks created from email are third-party text (§10).
  return fromEmail ? wrap(state, 'task', 'email', out) : JSON.parse(out);
}

async function google<T>(state: RunState, name: string, fn: () => Promise<T>): Promise<T | ToolError> {
  if (state.googleStatus === 'none') {
    state.needsReconnect = true;
    return err('INTEGRATION_RECONNECT_REQUIRED', 'Google is not connected. Tell the user to connect Google in Settings.');
  }
  const limit = await state.deps.rateLimit(state.userId, 'integration');
  if (!limit.allowed) return err('RATE_LIMITED');
  try {
    return await fn();
  } catch (e) {
    const code = toolErrorFor(e);
    if (code === 'INTEGRATION_RECONNECT_REQUIRED') {
      state.needsReconnect = true;
      return err(code, 'The Google connection has expired. Tell the user to reconnect Google in Settings.');
    }
    logger.warn('command.google_tool_failed', { tool: name, code, runId: state.runId });
    return err(code);
  }
}

// ───────────────────────── propose plumbing ─────────────────────────

type TaskTarget = { ok: true; target: NonNullable<Draft['target']>; taintedHandle: boolean } | { ok: false };

function taskTarget(state: RunState, handle: string): TaskTarget {
  const entry = state.handles.get(handle);
  if (!entry) return { ok: false };
  if (entry.type === 'task_set') {
    state.unresolved.delete(handle);
    return { ok: true, target: { taskIds: entry.taskIds, reason: entry.reason }, taintedHandle: false };
  }
  if (entry.type !== 'task') return { ok: false };
  if (entry.setHandle) {
    // A candidate of an ambiguous resolution: the user picks, not the model.
    const set = state.handles.get(entry.setHandle);
    state.unresolved.delete(entry.setHandle);
    if (set?.type === 'task_set') return { ok: true, target: { taskIds: set.taskIds, reason: set.reason }, taintedHandle: false };
  }
  return { ok: true, target: { taskId: entry.taskId }, taintedHandle: !entry.userDerived };
}

function draftFor(state: RunState, kind: ProposalKind, input: Record<string, unknown>, parts: Omit<Draft, 'kind' | 'tainted' | 'taintSources'>, taintedHandle = false): Draft {
  const strings = untrustedStrings(input, state.input, (s) => HANDLE_RE.test(s));
  const tainted = state.taint.size > 0 && (strings.length > 0 || taintedHandle);
  return { kind, ...parts, tainted, taintSources: tainted ? [...state.taint] : [] };
}

function dates(entries: Record<string, string | undefined>, allowNone: string[] = []): Draft['dates'] {
  const out: Draft['dates'] = {};
  for (const [k, v] of Object.entries(entries)) {
    if (v === undefined) continue;
    out[k] = allowNone.includes(k) && /^(none|no date)$/i.test(v.trim()) ? { none: true } : { phrase: v };
  }
  return out;
}

function unknownHandle(): ProposalResult {
  return { status: 'rejected', code: 'UNKNOWN_HANDLE', message: 'Use a handle returned by resolve_task, search_tasks or get_task in this run.' };
}

// ───────────────────────── registry ─────────────────────────

export function buildToolRegistry(state: RunState): ToolSet {
  const run = <I extends Record<string, unknown>>(name: string, fn: (input: I) => Promise<unknown>) =>
    async (input: I, opts: { toolCallId: string }) => {
      const started = Date.now();
      state.toolNames.push(name);
      const isRead = (READ_TOOLS as readonly string[]).includes(name);
      let output: unknown;
      let status: 'SUCCESS' | 'ERROR' = 'SUCCESS';
      try {
        if (isRead && state.outputBytes > MAX_RUN_OUTPUT_BYTES) output = err('CONTEXT_BUDGET');
        else output = await withTimeout(TIMEOUT_MS[name] ?? 3000, () => fn(input));
      } catch (e) {
        status = 'ERROR';
        output = e instanceof ToolTimeout ? err('PROVIDER_TIMEOUT') : e instanceof NotFoundError ? err('NOT_FOUND') : err(toolErrorFor(e));
      }
      if (output && typeof output === 'object' && 'error' in output) status = 'ERROR';
      const serialized = typeof output === 'string' ? output : JSON.stringify(output);
      const capped = capString(serialized);
      state.outputBytes += byteLength(capped);
      const ms = Date.now() - started;
      state.trace.push({ tool: name, ms, status: status === 'SUCCESS' ? 'ok' : 'error', ...(status === 'ERROR' && output && typeof output === 'object' && 'error' in output ? { error: String((output as ToolError).error) } : {}) });
      const proposalId = output && typeof output === 'object' && 'proposalId' in output ? String((output as { proposalId: string }).proposalId) : null;
      await recordToolCall(state.userId, {
        agentRunId: state.runId,
        proposedActionId: proposalId,
        toolName: name,
        toolCallId: opts.toolCallId,
        input: auditInput(name, input),
        // Read results are not stored (they hold third-party text); propose results are server summaries.
        output: isRead ? { status, bytes: byteLength(capped) } : output,
        status,
        durationMs: ms,
      });
      return typeof output === 'string' ? capped : output;
    };

  const propose = (kind: ProposalKind, build: (input: Record<string, unknown>) => Draft | ProposalResult) =>
    run(TOOL_KIND_NAME[kind], async (input: Record<string, unknown>) => {
      const draft = build(input);
      if ('status' in draft) return draft;
      return processDraft(state, draft);
    });

  return {
    // ─── read tools ───
    search_tasks: tool({
      description: "Find the user's tasks by text, status or due window (e.g. 'today', 'this week', 'overdue').",
      inputSchema: z.object({
        query: z.string().max(100).optional(),
        status: z.enum(['open', 'done', 'all']).default('open'),
        due: DatePhrase.optional(),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      execute: run('search_tasks', async ({ query, status, due, limit }: { query?: string; status: 'open' | 'done' | 'all'; due?: string; limit: number }) => {
        const filter: TaskFilter = status === 'open' ? { status: [...OPEN_STATUSES] } : status === 'done' ? { status: ['DONE'] } : {};
        const opts = { filter, limit: limit + 1, now: state.now, timeZone: state.prefs.timeZone };
        let tasks: Task[];
        const d = due?.toLowerCase().trim();
        if (d === 'overdue') tasks = (await listTasks(state.userId, { kind: 'overdue' }, opts)).items.map((i) => i.task);
        else {
          if (d) {
            const r = resolveDateRange({ phrase: d, now: state.now, prefs: state.prefs, maxDays: 366 });
            if (r.status !== 'resolved') return err('INVALID_INPUT', `Could not understand the due window "${due}".`);
            filter.dueOn = { from: r.startDate, toExclusive: r.endDate, timeZone: state.prefs.timeZone };
          }
          tasks = query
            ? (await searchTasks(state.userId, { ...opts, text: query })).items.map((i) => i.task)
            : (await listTasks(state.userId, { kind: 'all' }, opts)).items.map((i) => i.task);
        }
        const truncated = tasks.length > limit;
        const { list, fromEmail } = await summaries(state, tasks.slice(0, limit));
        if (list.length) state.sources.push(...list.slice(0, 5).map((t) => ({ type: 'task' as const, label: t.title })));
        return taskListOutput(state, list, fromEmail, { truncated }, truncated ? limit + 1 : list.length);
      }),
    }),

    get_task: tool({
      description: 'Full detail of one task, by handle.',
      inputSchema: z.object({ task: Handle }),
      execute: run('get_task', async ({ task }: { task: string }) => {
        const entry = state.handles.get(task);
        if (!entry || entry.type !== 'task') return err('UNKNOWN_HANDLE');
        const t = await getTask(state.userId, entry.taskId);
        const summary = await summarizeTask(state, t);
        const subtasks = await listSubtasks(state.userId, t.id).catch(() => [] as Task[]);
        const detail = {
          ...summary,
          description: (t.description ?? '').slice(0, 2000),
          tags: t.tags,
          subtasks: (await summaries(state, subtasks.slice(0, 10))).list,
          version: t.version,
        };
        return t.source === 'EMAIL' ? wrap(state, 'task', 'email', detail, summary.handle) : detail;
      }),
    }),

    resolve_task: tool({
      description:
        "Turn the user's reference to a task (\"the report\", \"it\") into candidates. Pass the user's exact words; pass pronouns literally. " +
        "If the result is ambiguous, pass the returned `reference` handle to the propose tool and the server will ask the user — never pick a candidate yourself.",
      inputSchema: z.object({ reference: z.string().trim().min(1).max(120), status: z.enum(['open', 'any']).default('open') }),
      execute: run('resolve_task', async ({ reference, status }: { reference: string; status: 'open' | 'any' }) => {
        const r = await resolveTaskReference(state, reference, status);
        if (r.match === 'none') return { match: 'none', reason: r.reason };
        if (r.match === 'unique') return { match: 'unique', task: await summarizeTask(state, r.task, { userDerived: r.userDerived }) };
        const setHandle = issueSetHandle(state, { type: 'task_set', taskIds: r.tasks.map((t) => t.id), reference, reason: r.reason });
        state.unresolved.set(setHandle, { reference, taskIds: r.tasks.map((t) => t.id), reason: r.reason });
        const candidates = await Promise.all(r.tasks.map((t) => summarizeTask(state, t, { setHandle })));
        return { match: 'ambiguous', reason: r.reason, reference: setHandle, candidates };
      }),
    }),

    list_agenda: tool({
      description: "Tasks and calendar events for a range such as 'today', 'tomorrow' or 'this week'.",
      inputSchema: z.object({ range: DatePhrase.default('today') }),
      execute: run('list_agenda', async ({ range }: { range: string }) => {
        const r = resolveDateRange({ phrase: range, now: state.now, prefs: state.prefs, maxDays: 31 });
        if (r.status !== 'resolved') return err('INVALID_INPUT', `Could not understand the range "${range}".`);
        const tz = state.prefs.timeZone;
        const filter: TaskFilter = { status: [...OPEN_STATUSES], dueOn: { from: r.startDate, toExclusive: r.endDate, timeZone: tz } };
        const tasks = (await listTasks(state.userId, { kind: 'all' }, { filter, limit: 30, now: state.now, timeZone: tz })).items.map((i) => i.task);
        const overdue = (await listTasks(state.userId, { kind: 'overdue' }, { limit: 10, now: state.now, timeZone: tz })).items.map((i) => i.task);
        const t = await summaries(state, tasks);
        const o = await summaries(state, overdue);
        let events: unknown[] = [];
        const failed: string[] = [];
        if (state.googleStatus !== 'none') {
          const res = await google(state, 'list_agenda', async () => (await state.deps.google(state.userId).calendar()).listEvents({ timeZone: tz, timeMin: r.start, timeMax: r.end }, { limit: 30 }));
          if ('error' in res) failed.push('calendar');
          else events = eventSummaries(state, res.events);
        }
        const body = { range: { start: r.start.toISOString(), end: r.end.toISOString(), label: r.label }, tasks: t.list, overdue: o.list, ...(failed.length ? { partial: { failedSources: failed } } : {}) };
        const calendarBlock = events.length ? `\n${wrap(state, 'calendar', 'calendar', { events })}` : '';
        const tasksPart = t.fromEmail || o.fromEmail ? wrap(state, 'task', 'email', body) : JSON.stringify(body);
        return capString(`${tasksPart}${calendarBlock}`);
      }),
    }),

    list_calendar_events: tool({
      description: "The user's Google Calendar events (read-only) in a range of at most 31 days, optionally matching text.",
      inputSchema: z.object({ range: DatePhrase, query: z.string().max(100).optional() }),
      execute: run('list_calendar_events', async ({ range, query }: { range: string; query?: string }) => {
        const r = resolveDateRange({ phrase: range, now: state.now, prefs: state.prefs, maxDays: 31 });
        if (r.status !== 'resolved') return err('INVALID_INPUT', r.status === 'too_long' ? 'Ranges are limited to 31 days.' : `Could not understand "${range}".`);
        const res = await google(state, 'list_calendar_events', async () =>
          (await state.deps.google(state.userId).calendar()).listEvents({ timeZone: state.prefs.timeZone, timeMin: r.start, timeMax: r.end }, { limit: 30, ...(query ? { query } : {}) }));
        if ('error' in res) return res;
        const events = eventSummaries(state, res.events);
        state.sources.push(...res.events.slice(0, 5).map((e) => ({ type: 'event' as const, label: e.title })));
        return fitList(events, (items, truncated) => wrap(state, 'calendar', 'calendar', { range: r.label, events: items, truncated: truncated || res.truncated }));
      }),
    }),

    search_email: tool({
      description: "Search the user's Gmail (Gmail search syntax allowed). Returns sender, subject and a short snippet.",
      inputSchema: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(10).default(5) }),
      execute: run('search_email', async ({ query, limit }: { query: string; limit: number }) => {
        const res = await google(state, 'search_email', async () => (await state.deps.google(state.userId).gmail()).search(query, { limit }));
        if ('error' in res) return res;
        const messages = res.slice(0, limit).map((m) => {
          const handle = issueHandle(state, 'eml', m.id, { type: 'email', messageId: m.id, threadId: m.threadId, from: m.from, subject: m.subject });
          return { handle, from: m.from, subject: m.subject, snippet: m.snippet.slice(0, 300), receivedAt: instantLabel(m.receivedAt, state.prefs.timeZone, state.now) };
        });
        state.sources.push(...res.slice(0, 5).map((m) => ({ type: 'email' as const, label: m.subject })));
        return fitList(messages, (items, truncated) => wrap(state, 'gmail', 'email', { messages: items, truncated }));
      }),
    }),

    get_email: tool({
      description: 'The plain-text body of one email, by handle from search_email.',
      inputSchema: z.object({ email: Handle }),
      execute: run('get_email', async ({ email }: { email: string }) => {
        const entry = state.handles.get(email);
        if (!entry || entry.type !== 'email') return err('UNKNOWN_HANDLE');
        const res = await google(state, 'get_email', async () => (await state.deps.google(state.userId).gmail()).get(entry.messageId));
        if ('error' in res) return res;
        state.handles.set(email, { ...entry, threadId: res.threadId || entry.threadId, from: res.from, subject: res.subject });
        return wrap(
          state,
          'gmail',
          'email',
          { handle: email, from: res.from, to: res.to, subject: res.subject, receivedAt: instantLabel(res.receivedAt, state.prefs.timeZone, state.now), body: res.body.slice(0, 6000), truncated: res.bodyTruncated || res.body.length > 6000 },
          email,
        );
      }),
    }),

    search_memory: tool({
      description: "Semantic search over facts the user asked you to remember.",
      inputSchema: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(8).default(5) }),
      execute: run('search_memory', async ({ query, limit }: { query: string; limit: number }) => {
        let hits;
        try {
          hits = await searchMemories(state.userId, query, { embed: state.deps.embed, limit });
        } catch {
          return err('PROVIDER_UNAVAILABLE', 'Memory search is unavailable right now.');
        }
        const memories = hits.map((m) => ({
          handle: issueHandle(state, 'mem', m.id, { type: 'memory', memoryId: m.id }),
          content: m.content.slice(0, 1000),
          createdAt: localDateOf(m.createdAt, state.prefs.timeZone),
        }));
        state.sources.push(...hits.slice(0, 5).map((m) => ({ type: 'memory' as const, label: m.content.slice(0, 60) })));
        return fitList(memories, (items, truncated) => wrap(state, 'memory', 'memory', { memories: items, truncated }));
      }),
    }),

    search_web: tool({
      description: 'Public web lookup. Only for facts not in the user\'s own data; build the query from the user\'s words only.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
      execute: run('search_web', async ({ query }: { query: string }) => {
        // A run that has read third-party content can't send queries out (SEC-B-012 exfiltration).
        if (state.taint.size > 0) return err('UNTRUSTED_CONTEXT', 'Web search is disabled after reading email, calendar or memory content in the same command.');
        const web = state.deps.web();
        if (!web) return err('PROVIDER_UNAVAILABLE', 'Web search is not configured.');
        try {
          const results = (await web.search(query, { limit: 5 })).slice(0, 5).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet.slice(0, 500) }));
          state.sources.push(...results.map((r) => ({ type: 'web' as const, label: r.title, href: r.url })));
          return fitList(results, (items, truncated) => wrap(state, 'web', 'web', { results: items, truncated }));
        } catch (e) {
          return err(toolErrorFor(e));
        }
      }),
    }),

    get_preferences: tool({
      description: "The user's time zone, workday and lunch times, week start and briefing time.",
      inputSchema: z.object({}),
      execute: run('get_preferences', async () => {
        const p = await getPreferences(state.userId);
        return {
          timeZone: p.timeZone,
          workdayStartsAt: p.workdayStart,
          workdayEndsAt: p.workdayEnd,
          lunchEndsAt: p.lunchEndsAt,
          weekStartsOn: p.weekStart,
          briefingTime: `${String(p.briefingHour).padStart(2, '0')}:${String(p.briefingMinute).padStart(2, '0')}`,
          locale: p.locale,
        };
      }),
    }),

    // ─── propose tools ───
    propose_create_task: tool({
      description: "Propose a new task. Dates are the user's own words (\"tomorrow\", \"Friday 3pm\").",
      inputSchema: z.object({
        title: Title,
        due: DatePhrase.optional(),
        start: DatePhrase.optional(),
        priority: Priority.optional(),
        project: z.string().max(80).optional(),
        tags: z.array(Tag).max(10).optional(),
        description: Description.optional(),
        estimateMinutes: z.number().int().min(1).max(1440).optional(),
        recurrence: z.string().max(80).optional(),
      }),
      execute: propose('task.create', (input) =>
        draftFor(state, 'task.create', input, {
          fields: { title: input.title, priority: input.priority, project: input.project, tags: input.tags, description: input.description, estimateMinutes: input.estimateMinutes, recurrence: input.recurrence },
          dates: dates({ due: input.due as string | undefined, start: input.start as string | undefined }),
        })),
    }),

    propose_update_task: tool({
      description: 'Propose rescheduling or editing one task (by handle). Use due:"none" to clear the due date.',
      inputSchema: z.object({
        task: Handle,
        changes: z
          .object({
            title: Title.optional(),
            due: DatePhrase.optional(),
            start: DatePhrase.optional(),
            priority: Priority.optional(),
            project: z.string().max(80).optional(),
            addTags: z.array(Tag).max(10).optional(),
            removeTags: z.array(Tag).max(10).optional(),
            description: Description.optional(),
            estimateMinutes: z.number().int().min(1).max(1440).optional(),
          })
          .refine((c) => Object.values(c).some((v) => v !== undefined), 'at least one change'),
      }),
      execute: propose('task.update', (input) => {
        const target = taskTarget(state, String(input.task));
        if (!target.ok) return unknownHandle();
        const c = input.changes as Record<string, unknown>;
        const { due, start, ...fields } = c;
        return draftFor(state, 'task.update', input, { target: target.target, fields, dates: dates({ due: due as string | undefined, start: start as string | undefined }, ['due', 'start']) }, target.taintedHandle);
      }),
    }),

    propose_complete_task: singleTaskTool(state, 'task.complete', 'Propose marking one task done.', propose),
    propose_reopen_task: singleTaskTool(state, 'task.reopen', 'Propose reopening a completed task (resolve it with status "any").', propose),
    propose_delete_task: singleTaskTool(state, 'task.delete', 'Propose deleting one task (soft delete; the user confirms).', propose),

    propose_snooze_task: tool({
      description: 'Propose hiding a task until a time (the user\'s words, e.g. "Monday").',
      inputSchema: z.object({ task: Handle, until: DatePhrase }),
      execute: propose('task.snooze', (input) => {
        const target = taskTarget(state, String(input.task));
        if (!target.ok) return unknownHandle();
        return draftFor(state, 'task.snooze', input, { target: target.target, fields: {}, dates: dates({ until: String(input.until) }) }, target.taintedHandle);
      }),
    }),

    propose_bulk_update_tasks: tool({
      description:
        'Propose the same change to many tasks selected by the server (e.g. selector {due:"overdue", priority:"LOW"}, change {due:"next week"}). Always needs the user\'s confirmation.',
      inputSchema: z.object({
        selector: z
          .object({
            query: z.string().max(100).optional(),
            status: z.literal('open').optional(),
            due: DatePhrase.optional(),
            project: z.string().max(80).optional(),
            priority: Priority.optional(),
          })
          .refine((s) => Object.values(s).some((v) => v !== undefined), 'at least one selector field'),
        change: z
          .object({ due: DatePhrase.optional(), status: z.literal('DONE').optional(), addTags: z.array(Tag).max(10).optional(), priority: Priority.optional() })
          .refine((c) => Object.values(c).some((v) => v !== undefined), 'at least one change'),
      }),
      execute: propose('task.bulk', (input) => {
        const change = input.change as { due?: string };
        return draftFor(state, 'task.bulk', input, {
          fields: { selector: input.selector, change: { ...change, due: undefined } },
          dates: dates({ 'change.due': change.due }),
        });
      }),
    }),

    propose_create_reminder: tool({
      description: 'Propose a reminder at a time (the user\'s words), on a task handle or standalone with a title.',
      inputSchema: z.object({ task: Handle.optional(), title: Title.optional(), at: DatePhrase }).refine((r) => r.task || r.title, 'task or title required'),
      execute: propose('reminder.create', (input) => {
        let target: Draft['target'];
        let taintedHandle = false;
        if (input.task) {
          const t = taskTarget(state, String(input.task));
          if (!t.ok) return unknownHandle();
          target = t.target;
          taintedHandle = t.taintedHandle;
        }
        return draftFor(state, 'reminder.create', input, { target, fields: { title: input.title }, dates: dates({ at: String(input.at) }) }, taintedHandle);
      }),
    }),

    propose_email_draft: tool({
      description:
        'Propose a Gmail draft (never sent). replyTo is an email handle from search_email/get_email; otherwise give to and subject. The user always reviews it first.',
      inputSchema: z
        .object({
          replyTo: Handle.optional(),
          to: z.array(z.string().email()).max(10).optional(),
          subject: z.string().max(200).optional(),
          body: z.string().min(1).max(5000),
        })
        .refine((d) => d.replyTo || (d.to?.length && d.subject), 'to and subject are required without replyTo'),
      execute: propose('email.draft', (input) => {
        let email: EmailRef | undefined;
        if (input.replyTo) {
          const entry = state.handles.get(String(input.replyTo));
          if (!entry || entry.type !== 'email') return unknownHandle();
          email = { messageId: entry.messageId, threadId: entry.threadId, from: entry.from, subject: entry.subject };
        }
        return draftFor(state, 'email.draft', input, { fields: { to: input.to, subject: input.subject, body: input.body }, dates: {}, email });
      }),
    }),

    save_memory: tool({
      description: 'Propose saving a fact the user asked you to remember (their words).',
      inputSchema: z.object({ content: z.string().trim().min(1).max(1000) }),
      execute: propose('memory.save', (input) => draftFor(state, 'memory.save', input, { fields: { content: input.content }, dates: {} })),
    }),
  };
}

const TOOL_KIND_NAME: Record<ProposalKind, string> = Object.fromEntries(Object.entries(TOOL_KIND).map(([name, kind]) => [kind, name])) as Record<ProposalKind, string>;

function singleTaskTool(
  state: RunState,
  kind: 'task.complete' | 'task.reopen' | 'task.delete',
  description: string,
  propose: (kind: ProposalKind, build: (input: Record<string, unknown>) => Draft | ProposalResult) => (input: Record<string, unknown>, opts: { toolCallId: string }) => Promise<unknown>,
) {
  return tool({
    description,
    inputSchema: z.object({ task: Handle }),
    execute: propose(kind, (input) => {
      const target = taskTarget(state, String(input.task));
      if (!target.ok) return unknownHandle();
      return draftFor(state, kind, input, { target: target.target, fields: {}, dates: {} }, target.taintedHandle);
    }),
  });
}

function eventSummaries(state: RunState, events: { id: string; title: string; start: string; end: string; allDay: boolean; location?: string; description?: string }[]) {
  const tz = state.prefs.timeZone;
  return events.slice(0, 30).map((e) => ({
    handle: issueHandle(state, 'evt', e.id, { type: 'event', eventId: e.id }),
    title: e.title,
    start: e.allDay ? e.start : instantLabel(new Date(e.start), tz, state.now),
    end: e.allDay ? e.end : instantLabel(new Date(e.end), tz, state.now),
    allDay: e.allDay,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description.slice(0, 500) } : {}),
  }));
}

export const TOOL_NAMES = [...READ_TOOLS, ...PROPOSE_TOOLS];
