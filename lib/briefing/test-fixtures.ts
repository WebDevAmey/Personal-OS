// lib/briefing/test-fixtures.ts — test doubles for briefing tests (docs/09 §3-4).
// Not imported by production code.
import { MockLanguageModelV4 } from 'ai/test';
import type { BriefingContext, EmailFact, EventFact, GoogleDeps, TaskFact } from './context';
import type { StepLike } from './service';
import type { BriefingEventPayload } from './events';
import type { EmailMessage, NormalizedEvent } from '@/lib/integrations/types';
import { createLogger } from '@/lib/observability/logger';

export const silentLogger = createLogger({}, () => {});

/** Executes steps inline; outputs go through JSON like Inngest's step state. */
export function fakeStep(): StepLike & { sent: BriefingEventPayload[]; ids: string[] } {
  const sent: BriefingEventPayload[] = [];
  const ids: string[] = [];
  return {
    sent,
    ids,
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      ids.push(id);
      const out = await fn();
      return (out === undefined ? null : JSON.parse(JSON.stringify(out))) as T;
    },
    async sendEvent(_id: string, events: BriefingEventPayload[]) {
      sent.push(...events);
    },
  };
}

export interface ModelItem {
  kind: string;
  title: string;
  reason: string;
  priority: string;
  isInferred: boolean;
  sources: { type: string; id: string }[];
  suggestedCommand?: string | null;
}

/** Mock language model returning `items` as the structured object; records every call. */
export function mockModel(items: ModelItem[] | (() => never)) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      if (typeof items === 'function') items();
      return {
        content: [{ type: 'text', text: JSON.stringify({ items }) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1200, noCache: 1200, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 300, text: 300, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

export interface FakeGoogleOptions {
  emails?: EmailMessage[];
  events?: NormalizedEvent[];
  /** Thrown by getAccessToken (after calling onNeedsReconnect if it is a NeedsReconnectError). */
  tokenError?: () => Error;
  gmailError?: () => Error;
  calendarError?: () => Error;
  /** Fail gmail this many times, then succeed. */
  gmailFailTimes?: number;
}

export function fakeGoogle(opts: FakeGoogleOptions = {}): GoogleDeps & { tokenCalls: string[]; gmailCalls: number } {
  let gmailFailures = 0;
  const g = {
    tokenCalls: [] as string[],
    gmailCalls: 0,
    async getAccessToken(userId: string, o: { onNeedsReconnect?: (u: string) => void | Promise<void> }) {
      g.tokenCalls.push(userId);
      if (opts.tokenError) {
        const err = opts.tokenError();
        if (err.name === 'NeedsReconnectError') await o.onNeedsReconnect?.(userId);
        throw err;
      }
      return `fake-token-for-${userId}`;
    },
    gmail() {
      return {
        async search() {
          g.gmailCalls++;
          if (opts.gmailError && (opts.gmailFailTimes === undefined || gmailFailures < opts.gmailFailTimes)) {
            gmailFailures++;
            throw opts.gmailError();
          }
          return opts.emails ?? [];
        },
      };
    },
    calendar() {
      return {
        async listEvents() {
          if (opts.calendarError) throw opts.calendarError();
          return { events: opts.events ?? [], timeMin: '', timeMax: '', timeZone: 'UTC', truncated: false };
        },
      };
    },
  };
  return g;
}

export function email(id: string, from: string, subject: string, snippet: string, receivedAt = new Date('2026-10-21T21:42:00Z')): EmailMessage {
  return { id, threadId: `t_${id}`, from, subject, snippet, receivedAt, untrusted: true };
}

export function calEvent(id: string, title: string, start: string, end: string): NormalizedEvent {
  return { id, title, start, end, allDay: false, timeZone: 'America/New_York', descriptionTruncated: false, attendeesCount: 2, status: 'confirmed', untrusted: true };
}

/** In-memory context for pure (unit) tests. */
export function makeContext(partial: Partial<BriefingContext> = {}): BriefingContext {
  const at = '2026-10-22T10:30:00.000Z';
  return {
    userId: 'user_a',
    localDate: '2026-10-22',
    timeZone: 'America/New_York',
    gatheredAt: at,
    tasks: [],
    reminders: [],
    emails: [],
    events: [],
    memories: [],
    sourceStatus: {
      tasks: { status: 'ok', at },
      gmail: { status: 'ok', at },
      calendar: { status: 'ok', at },
      memory: { status: 'skipped', at },
    },
    ...partial,
  };
}

export function taskFact(id: string, title: string, extra: Partial<TaskFact> = {}): TaskFact {
  return { id, title, status: 'TODO', priority: 0, dueDate: '2026-10-22', dueTime: null, bucket: 'today', source: 'MANUAL', ...extra };
}

export function emailFact(id: string, from: string, subject: string, snippet = ''): EmailFact {
  return { id, threadId: `t_${id}`, from, subject, snippet, receivedAt: '2026-10-21T21:42:00.000Z' };
}

export function eventFact(id: string, title: string, start: string, end: string): EventFact {
  return { id, title, start, end, allDay: false, location: null, attendeesCount: 2 };
}
