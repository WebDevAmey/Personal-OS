// lib/briefing/context.ts — gathers one user's briefing context (BRIEF-002).
//
// Every read is keyed on the explicit `userId` of the job (T-BOLA-06): tasks,
// reminders and memories through their ownership-scoped repos, Gmail and
// Calendar through a token fetched for that same user. Sources are isolated:
// a Google failure is recorded per source (PARTIAL), never thrown, except a
// retryable failure on a non-final attempt, which is rethrown so the Inngest
// step retries it (FR-310 "fails after retries").
//
// The result is JSON-safe (it is an Inngest step output) and holds no tokens.
// Email data is limited to ids, sender, subject, date and a ≤ 200-char
// snippet (FR-706).
import { logger as defaultLogger, type Logger } from '@/lib/observability/logger';
import { searchMemories, type EmbedFn } from '@/lib/memory/repo';
import { listReminders, listTasks, type Task } from '@/lib/tasks/repo';
import { addDays, floatingToLocalDate, localDateOf, localDayRange, type LocalDate } from '@/lib/time';
import {
  IntegrationScopeError,
  NeedsReconnectError,
  ProviderUnavailableError,
  RateLimitedError,
  TokenRefreshFailedError,
  isIntegrationError,
} from '@/lib/integrations/errors';
import { clip } from '@/lib/integrations/text';
import type { EmailMessage, ListEventsResult, LocalDateRange } from '@/lib/integrations/types';
import { getGoogleAccountState, listSnoozedWaking, markGoogleNeedsReconnect } from './repo';
import type { SourceErrorClass, SourceName, SourceStatus } from './types';

export const GMAIL_QUERY = 'is:unread newer_than:2d (category:primary OR is:important)';
export const GMAIL_LIMIT = 25;
export const EVENT_LIMIT = 30;
export const SNIPPET_MAX = 200;
export const MEMORY_LIMIT = 5;
export const MEMORY_MIN_SIMILARITY = 0.75;

export interface TaskFact {
  id: string;
  title: string;
  status: string;
  /** 0 NONE … 4 URGENT */
  priority: number;
  /** Local date the task is due (date-only or the local date of a timed deadline). */
  dueDate: LocalDate | null;
  /** Local HH:mm for timed deadlines. */
  dueTime: string | null;
  bucket: 'overdue' | 'today' | 'upcoming' | 'snoozed_waking';
  source: string;
}

export interface ReminderFact {
  id: string;
  taskId: string | null;
  title: string;
  /** Local HH:mm today. */
  at: string;
}

export interface EmailFact {
  id: string;
  threadId: string | null;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export interface EventFact {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  attendeesCount: number;
}

export interface MemoryFact {
  id: string;
  content: string;
}

export interface BriefingContext {
  userId: string;
  localDate: LocalDate;
  timeZone: string;
  gatheredAt: string;
  tasks: TaskFact[];
  reminders: ReminderFact[];
  emails: EmailFact[];
  events: EventFact[];
  memories: MemoryFact[];
  sourceStatus: Record<SourceName, SourceStatus>;
}

interface TokenOpts {
  onNeedsReconnect?: (userId: string) => void | Promise<void>;
  logger?: Logger;
}

interface ClientOpts {
  userId: string;
  onNeedsReconnect?: (userId: string) => void | Promise<void>;
  logger?: Logger;
}

/** The capability seam: production wires lib/integrations; tests pass fakes. */
export interface GoogleDeps {
  getAccessToken(userId: string, opts: TokenOpts): Promise<string>;
  gmail(accessToken: string, opts: ClientOpts): { search(query: string, opts?: { limit?: number }): Promise<EmailMessage[]> };
  calendar(accessToken: string, opts: ClientOpts): { listEvents(range: LocalDateRange, opts?: { limit?: number }): Promise<ListEventsResult> };
}

export interface GatherDeps {
  google: GoogleDeps;
  /** null ⇒ memory source skipped (no embedder configured). */
  embed: EmbedFn | null;
  logger?: Logger;
}

export interface GatherInput {
  userId: string;
  localDate: LocalDate;
  timeZone: string;
  now: Date;
  /** Inngest attempt (0-based) and whether it is the last one. */
  finalAttempt: boolean;
}

/** A retryable source failure on a non-final attempt: thrown so the step retries. */
export class RetryableSourceError extends Error {
  constructor(readonly source: SourceName, readonly errorClass: SourceErrorClass) {
    super(`${source} temporarily unavailable (${errorClass})`);
    this.name = 'RetryableSourceError';
  }
}

export function classifySourceError(err: unknown): { errorClass: SourceErrorClass; retryable: boolean } {
  if (err instanceof NeedsReconnectError || err instanceof IntegrationScopeError) return { errorClass: 'auth', retryable: false };
  if (err instanceof RateLimitedError) return { errorClass: 'quota', retryable: true };
  if (err instanceof ProviderUnavailableError) return { errorClass: 'network', retryable: err.retryable };
  if (err instanceof TokenRefreshFailedError) return { errorClass: 'auth', retryable: false };
  if (isIntegrationError(err)) return { errorClass: 'unknown', retryable: false };
  return { errorClass: 'unknown', retryable: false };
}

function isNoAccount(err: unknown): boolean {
  return err instanceof Error && err.name === 'NoIntegrationAccountError';
}

function hhmm(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
}

function taskFact(t: Task, bucket: TaskFact['bucket'], timeZone: string): TaskFact {
  let dueDate: LocalDate | null = null;
  let dueTime: string | null = null;
  if (t.dueAt) {
    dueDate = t.dueHasTime ? localDateOf(t.dueAt, timeZone) : floatingToLocalDate(t.dueAt);
    if (t.dueHasTime) dueTime = hhmm(t.dueAt, timeZone);
  }
  return { id: t.id, title: clip(t.title, 200), status: t.status, priority: t.priority, dueDate, dueTime, bucket, source: t.source };
}

async function gatherTasks(input: GatherInput): Promise<{ tasks: TaskFact[]; reminders: ReminderFact[] }> {
  const { userId, localDate, timeZone, now } = input;
  const { start, end } = localDayRange(localDate, timeZone);
  const [today, upcoming, waking, reminders] = await Promise.all([
    listTasks(userId, { kind: 'today' }, { now, timeZone, limit: 50 }),
    listTasks(userId, { kind: 'upcoming' }, {
      now,
      timeZone,
      limit: 20,
      filter: { dueOn: { from: addDays(localDate, 1), toExclusive: addDays(localDate, 4), timeZone } },
    }),
    listSnoozedWaking(userId, start, end, 20),
    listReminders(userId, { status: ['PENDING'], from: start, to: end, limit: 20 }),
  ]);
  const seen = new Set<string>();
  const tasks: TaskFact[] = [];
  const push = (t: Task, bucket: TaskFact['bucket']) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    tasks.push(taskFact(t, bucket, timeZone));
  };
  for (const { task, group } of today.items) push(task, group === 'overdue' ? 'overdue' : 'today');
  for (const t of waking) push(t, 'snoozed_waking');
  for (const { task } of upcoming.items) push(task, 'upcoming');
  return {
    tasks,
    reminders: reminders.map((r) => ({ id: r.id, taskId: r.taskId, title: clip(r.title, 200), at: hhmm(r.remindAt, timeZone) })),
  };
}

function emailFact(m: EmailMessage): EmailFact {
  return {
    id: m.id,
    threadId: m.threadId ?? null,
    from: clip(m.from, 200),
    subject: clip(m.subject, 200),
    snippet: clip(m.snippet, SNIPPET_MAX),
    receivedAt: m.receivedAt instanceof Date ? m.receivedAt.toISOString() : String(m.receivedAt),
  };
}

function memoryQuery(tasks: TaskFact[], events: EventFact[]): string {
  return clip([...events.map((e) => e.title), ...tasks.filter((t) => t.bucket !== 'upcoming').map((t) => t.title)].join('; '), 500);
}

/** Gathers all sources for one user. Throws only for our own DB failures or a retryable source failure on a non-final attempt. */
export async function gatherContext(input: GatherInput, deps: GatherDeps): Promise<BriefingContext> {
  const log = (deps.logger ?? defaultLogger).child({ userId: input.userId, localDate: input.localDate });
  const at = input.now.toISOString();
  const status = {} as Record<SourceName, SourceStatus>;

  // Tasks are our own database: a failure here throws (Inngest retries; onFailure marks FAILED).
  const { tasks, reminders } = await gatherTasks(input);
  status.tasks = { status: 'ok', count: tasks.length + reminders.length, at };

  const onNeedsReconnect = async (uid: string) => {
    // Always the job's own user: the integration layer echoes back the id we gave it.
    if (uid !== input.userId) return;
    await markGoogleNeedsReconnect(input.userId, input.now);
  };

  let emails: EmailFact[] = [];
  let events: EventFact[] = [];
  const accountState = await getGoogleAccountState(input.userId);
  if (accountState === 'NONE' || accountState === 'DISCONNECTED') {
    status.gmail = { status: 'not_connected', at };
    status.calendar = { status: 'not_connected', at };
  } else if (accountState === 'NEEDS_REAUTH') {
    status.gmail = { status: 'failed', errorClass: 'auth', at };
    status.calendar = { status: 'failed', errorClass: 'auth', at };
  } else {
    let token: string | null = null;
    try {
      token = await deps.google.getAccessToken(input.userId, { onNeedsReconnect, logger: log });
    } catch (err) {
      if (isNoAccount(err)) {
        status.gmail = { status: 'not_connected', at };
        status.calendar = { status: 'not_connected', at };
      } else {
        const c = classifySourceError(err);
        if (c.retryable && !input.finalAttempt) throw new RetryableSourceError('gmail', c.errorClass);
        log.warn('briefing.source_failed', { source: 'google_token', errorClass: c.errorClass, errorName: (err as Error)?.name });
        status.gmail = { status: 'failed', errorClass: c.errorClass, at };
        status.calendar = { status: 'failed', errorClass: c.errorClass, at };
      }
    }
    if (token) {
      const clientOpts: ClientOpts = { userId: input.userId, onNeedsReconnect, logger: log };
      const [gm, cal] = await Promise.allSettled([
        deps.google.gmail(token, clientOpts).search(GMAIL_QUERY, { limit: GMAIL_LIMIT }),
        deps.google.calendar(token, clientOpts).listEvents(
          { timeZone: input.timeZone, startDate: input.localDate, endDate: input.localDate },
          { limit: EVENT_LIMIT },
        ),
      ]);
      const failures: [SourceName, unknown][] = [];
      if (gm.status === 'fulfilled') {
        emails = gm.value.slice(0, GMAIL_LIMIT).map(emailFact);
        status.gmail = { status: 'ok', count: emails.length, at };
      } else failures.push(['gmail', gm.reason]);
      if (cal.status === 'fulfilled') {
        events = cal.value.events.slice(0, EVENT_LIMIT).map((e) => ({
          id: e.id,
          title: clip(e.title, 200),
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          location: e.location ? clip(e.location, 120) : null,
          attendeesCount: e.attendeesCount,
        }));
        status.calendar = { status: 'ok', count: events.length, at };
      } else failures.push(['calendar', cal.reason]);
      for (const [source, err] of failures) {
        const c = classifySourceError(err);
        if (c.retryable && !input.finalAttempt) throw new RetryableSourceError(source, c.errorClass);
        log.warn('briefing.source_failed', { source, errorClass: c.errorClass, errorName: (err as Error)?.name });
        status[source] = { status: 'failed', errorClass: c.errorClass, at };
      }
    }
  }

  let memories: MemoryFact[] = [];
  const q = memoryQuery(tasks, events);
  if (!deps.embed || q.length === 0) {
    status.memory = { status: 'skipped', at };
  } else {
    try {
      const hits = await searchMemories(input.userId, q, { embed: deps.embed, limit: MEMORY_LIMIT, minSimilarity: MEMORY_MIN_SIMILARITY });
      memories = hits.map((h) => ({ id: h.id, content: clip(h.content, 300) }));
      status.memory = { status: 'ok', count: memories.length, at };
    } catch (err) {
      log.warn('briefing.source_failed', { source: 'memory', errorName: (err as Error)?.name });
      status.memory = { status: 'failed', errorClass: 'unknown', at };
    }
  }

  return { userId: input.userId, localDate: input.localDate, timeZone: input.timeZone, gatheredAt: at, tasks, reminders, emails, events, memories, sourceStatus: status };
}

export function failedSourcesOf(ctx: Pick<BriefingContext, 'sourceStatus'>): SourceName[] {
  return (Object.entries(ctx.sourceStatus) as [SourceName, SourceStatus][]).filter(([, s]) => s.status === 'failed').map(([n]) => n);
}
