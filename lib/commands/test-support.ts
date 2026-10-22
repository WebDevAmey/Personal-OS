// lib/commands/test-support.ts — fakes for command pipeline tests: a scripted
// mock language model (driven through the real generateText loop) and
// CommandDeps whose Google, web and embedding seams record every call.
// Test-only; never imported by application code.
import { randomUUID } from 'node:crypto';
import { MockLanguageModelV4 } from 'ai/test';
import type { CreateDraftInput, EmailDetail, EmailMessage, NormalizedEvent, WebResult } from '@/lib/integrations/types';
import type { CommandDeps, GmailLike } from './deps';

type LanguageModelV4CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0];
type LanguageModelV4GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

export interface ToolResultSeen {
  toolName: string;
  /** JSON value, or the raw string for text results (untrusted blocks). */
  value: unknown;
  /** Serialised form, for regex lookups of handles. */
  text: string;
}

export interface StepContext {
  /** Results of the tool calls made in the previous step. */
  results: ToolResultSeen[];
  /** Every tool result so far in this run. */
  all: ToolResultSeen[];
  call: LanguageModelV4CallOptions;
}

export type ToolCallSpec = { tool: string; input: Record<string, unknown> };
export type Step = ToolCallSpec[] | string | ((ctx: StepContext) => ToolCallSpec[] | string);

const usage = { inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: 0 }, outputTokens: { total: 30, text: 30, reasoning: 0 } };

function toolResults(call: LanguageModelV4CallOptions): { last: ToolResultSeen[]; all: ToolResultSeen[] } {
  const all: ToolResultSeen[] = [];
  let last: ToolResultSeen[] = [];
  for (const msg of call.prompt) {
    if (msg.role !== 'tool') continue;
    const batch: ToolResultSeen[] = [];
    for (const part of msg.content) {
      if (part.type !== 'tool-result') continue;
      const out = part.output as { type: string; value?: unknown };
      const value = out.value;
      batch.push({ toolName: part.toolName, value, text: typeof value === 'string' ? value : JSON.stringify(value) });
    }
    all.push(...batch);
    last = batch;
  }
  return { last, all };
}

/** A model that plays `steps` in order, one per generateText step, then answers `final`. */
export function scriptedModel(steps: Step[], final = ''): MockLanguageModelV4 {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async (call): Promise<LanguageModelV4GenerateResult> => {
      const { last, all } = toolResults(call);
      const step = steps[i++];
      const resolved = typeof step === 'function' ? step({ results: last, all, call }) : (step ?? final);
      if (typeof resolved === 'string') {
        return { content: resolved ? [{ type: 'text', text: resolved }] : [], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
      }
      return {
        content: resolved.map((c) => ({ type: 'tool-call' as const, toolCallId: `call_${randomUUID().slice(0, 8)}`, toolName: c.tool, input: JSON.stringify(c.input) })),
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

/** A model whose every call fails, e.g. with a timeout. */
export function failingModel(error: Error): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

/** First handle with `prefix` (tsk_h_, eml_h_ …) in the given results. */
export function handleIn(results: ToolResultSeen[], prefix: 'tsk_h_' | 'eml_h_' | 'evt_h_' | 'mem_h_'): string {
  for (const r of results) {
    const m = r.text.match(new RegExp(`${prefix}[a-z2-7]{10}`));
    if (m) return m[0];
  }
  throw new Error(`no ${prefix} handle in ${results.map((r) => r.toolName).join(', ') || 'no results'}`);
}

export interface FakeGmailData {
  messages?: (EmailMessage & { body?: string; to?: string })[];
}

export interface FakeGoogle {
  gmail: GmailLike;
  calls: { search: string[]; get: string[]; createDraft: CreateDraftInput[]; findDraft: string[]; calendar: number };
  drafts: Map<string, { draftId: string }>;
  events?: NormalizedEvent[];
}

export function fakeGoogle(data: FakeGmailData & { events?: NormalizedEvent[]; failDraftOnce?: Error } = {}): FakeGoogle {
  const calls: FakeGoogle['calls'] = { search: [], get: [], createDraft: [], findDraft: [], calendar: 0 };
  const drafts = new Map<string, { draftId: string }>();
  let failDraft = data.failDraftOnce;
  const messages = data.messages ?? [];
  const gmail: GmailLike = {
    async search(query) {
      calls.search.push(query);
      return messages.map((m) => ({ id: m.id, from: m.from, subject: m.subject, snippet: m.snippet, receivedAt: m.receivedAt, threadId: m.threadId, untrusted: true as const }));
    },
    async get(id) {
      calls.get.push(id);
      const m = messages.find((x) => x.id === id);
      if (!m) throw new Error('not found');
      const detail: EmailDetail = {
        id: m.id,
        threadId: m.threadId ?? `thr_${m.id}`,
        from: m.from,
        to: m.to ?? 'me@example.test',
        cc: '',
        subject: m.subject,
        receivedAt: m.receivedAt,
        body: m.body ?? m.snippet,
        bodyTruncated: false,
        bodySource: 'text/plain',
        untrusted: true,
      } as EmailDetail;
      return detail;
    },
    async createDraft(input) {
      calls.createDraft.push(input);
      if (failDraft) {
        const e = failDraft;
        failDraft = undefined;
        // The draft reached Gmail but the response was lost.
        if (input.messageIdHeader) drafts.set(input.messageIdHeader, { draftId: `dr_${drafts.size + 1}` });
        throw e;
      }
      const d = { draftId: `dr_${drafts.size + 1}` };
      if (input.messageIdHeader) drafts.set(input.messageIdHeader, d);
      return { ...d, messageId: `msg_${d.draftId}`, threadId: input.threadId };
    },
    async findDraftByMessageId(header) {
      calls.findDraft.push(header);
      return drafts.get(header) ?? null;
    },
  };
  return { gmail, calls, drafts, events: data.events };
}

export interface FakeDepsOptions {
  model: MockLanguageModelV4;
  now: Date;
  google?: FakeGoogle;
  web?: WebResult[];
  rateLimited?: boolean;
}

export interface FakeDeps extends CommandDeps {
  webQueries: string[];
  embedCalls: number;
}

/** 512-dim deterministic embedding, so memory dedupe and search work offline. */
function fakeEmbedding(text: string): number[] {
  const v = new Array(512).fill(0);
  for (let i = 0; i < text.length; i++) v[(text.charCodeAt(i) * 31 + i) % 512] += 1;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function fakeDeps(opts: FakeDepsOptions): FakeDeps {
  const deps: FakeDeps = {
    webQueries: [],
    embedCalls: 0,
    now: () => opts.now,
    model: () => opts.model,
    google: () => ({
      async gmail() {
        if (!opts.google) throw new Error('google not configured in test');
        return opts.google.gmail;
      },
      async calendar() {
        if (!opts.google) throw new Error('google not configured in test');
        const g = opts.google;
        return {
          async listEvents(range) {
            g.calls.calendar++;
            const events = g.events ?? [];
            return { events, timeMin: 'timeMin' in range ? range.timeMin.toISOString() : range.startDate, timeMax: 'timeMax' in range ? range.timeMax.toISOString() : range.endDate, timeZone: range.timeZone, truncated: false };
          },
        };
      },
    }),
    web: () =>
      opts.web
        ? {
            async search(query) {
              deps.webQueries.push(query);
              return opts.web!;
            },
          }
        : null,
    embed: async (text: string) => {
      deps.embedCalls++;
      return fakeEmbedding(text);
    },
    rateLimit: async () => (opts.rateLimited ? { allowed: false, retryAfterMs: 30_000 } : { allowed: true }),
  };
  return deps;
}
