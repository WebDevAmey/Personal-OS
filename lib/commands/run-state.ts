// lib/commands/run-state.ts — per-run, in-memory state of one command:
// the handle map (docs/04 §5 "Handles"), taint sources (§10.2) and the
// outcomes the final response is built from (§10.3: never from model text).
import { randomBytes } from 'node:crypto';
import type { TaskSource } from '@/lib/generated/prisma/client';
import type { CommandDeps } from './deps';
import type { DatePrefs } from './dates';
import type { AnswerSource, ClarificationOption, ExecutedAction, ProposalView, TaintSource } from './types';

export type HandleEntry =
  | { type: 'task'; taskId: string; userDerived: boolean; setHandle?: string }
  | { type: 'task_set'; taskIds: string[]; reference: string; reason: 'ambiguous' | 'no_antecedent' }
  | { type: 'email'; messageId: string; threadId?: string; from: string; subject: string }
  | { type: 'event'; eventId: string }
  | { type: 'memory'; memoryId: string };

export type HandlePrefix = 'tsk' | 'eml' | 'evt' | 'mem';

export const HANDLE_RE = /^(tsk|eml|evt|mem)_h_[a-z2-7]{10}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function newHandle(prefix: HandlePrefix): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += BASE32[b & 31];
  return `${prefix}_h_${out}`;
}

export type Outcome =
  | { kind: 'executed'; proposalId: string; action: ExecutedAction }
  | { kind: 'proposal'; proposal: ProposalView }
  | { kind: 'clarification'; proposalId: string; message: string; question: string; options: ClarificationOption[]; allowFreeText: boolean }
  | { kind: 'rejected'; code: string; message: string; policy: boolean };

export interface ToolTraceEntry {
  tool: string;
  ms: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface RunState {
  userId: string;
  runId: string;
  /** The user's own words for this command (taint baseline). */
  input: string;
  source: Extract<TaskSource, 'COMMAND' | 'VOICE'>;
  now: Date;
  prefs: DatePrefs;
  deps: CommandDeps;
  requestId?: string;
  handles: Map<string, HandleEntry>;
  /** Reverse map so the same entity keeps one handle within a run. */
  handleOf: Map<string, string>;
  taint: Set<TaintSource>;
  outcomes: Outcome[];
  trace: ToolTraceEntry[];
  outputBytes: number;
  needsReconnect: boolean;
  googleStatus: 'connected' | 'needs_reauth' | 'none';
  /** Resolved references carried over from a clarification pick (normalised phrase → task id). */
  pinned: Map<string, string>;
  focusedTaskId?: string;
  /** Tasks the user's previous executed run touched (< 10 min), for "it". */
  antecedentTaskIds: string[];
  sources: AnswerSource[];
  toolNames: string[];
}

export function issueHandle(state: RunState, prefix: HandlePrefix, key: string, entry: HandleEntry): string {
  const existing = state.handleOf.get(`${prefix}:${key}`);
  if (existing) {
    const prev = state.handles.get(existing);
    // A task first seen as a user-derived resolution stays user-derived.
    if (prev && prev.type === 'task' && entry.type === 'task') {
      state.handles.set(existing, {
        ...prev,
        userDerived: prev.userDerived || entry.userDerived,
        setHandle: entry.userDerived ? undefined : (entry.setHandle ?? prev.setHandle),
      });
    }
    return existing;
  }
  const handle = newHandle(prefix);
  state.handles.set(handle, entry);
  state.handleOf.set(`${prefix}:${key}`, handle);
  return handle;
}

/** A task-set handle is unique per resolution, never reused. */
export function issueSetHandle(state: RunState, entry: Extract<HandleEntry, { type: 'task_set' }>): string {
  const handle = newHandle('tsk');
  state.handles.set(handle, entry);
  return handle;
}

// ───────────────────────── taint (§10.2) ─────────────────────────

export function normaliseForTaint(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when `value` is a verbatim (case/whitespace-normalised) substring of the user's input. */
export function inUserInput(value: string, input: string): boolean {
  const v = normaliseForTaint(value);
  if (v.length === 0) return true;
  return normaliseForTaint(input).includes(v);
}

/** Every string argument (deep) not found in the user's words, skipping handle strings. */
export function untrustedStrings(args: unknown, input: string, isHandle: (s: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (!isHandle(v) && !inUserInput(v, input)) out.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(args);
  return out;
}
