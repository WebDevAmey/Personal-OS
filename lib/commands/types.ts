// lib/commands/types.ts — HTTP and tool contracts of the command pipeline
// (docs/04 §5, §9, §12). Shared by the route handlers, the orchestrator and
// the UI. Everything the client receives is built from server state; the
// model's text only ever fills `message`.
import { z } from 'zod';

export const MAX_INPUT_CHARS = 2000;

// ───────────────────────── requests ─────────────────────────

export const CommandRequest = z
  .object({
    clientRequestId: z.string().uuid(),
    input: z.string().trim().min(1).max(MAX_INPUT_CHARS).optional(),
    replyTo: z.object({ runId: z.string().min(1).max(64), optionId: z.string().min(1).max(64).optional() }).optional(),
    source: z.enum(['typed', 'voice']).default('typed'),
    context: z
      .object({
        focusedTaskId: z.string().min(1).max(64).optional(),
        page: z.enum(['today', 'tasks', 'other']).optional(),
        previousRunId: z.string().min(1).max(64).optional(),
      })
      .optional(),
  })
  .refine((r) => r.input || r.replyTo?.optionId, 'input or replyTo.optionId required');
export type CommandRequest = z.infer<typeof CommandRequest>;

export const ConfirmRequest = z.object({
  proposalId: z.string().min(1).max(64),
  decision: z.enum(['confirm', 'cancel']).default('confirm'),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequest>;

export const UndoRequest = z
  .object({ taskEventId: z.string().min(1).max(64).optional(), batchId: z.string().min(1).max(64).optional() })
  .refine((r) => Boolean(r.taskEventId) !== Boolean(r.batchId), 'exactly one of taskEventId or batchId');
export type UndoRequest = z.infer<typeof UndoRequest>;

// ───────────────────────── risk & reasons ─────────────────────────

export const RISKS = ['READ', 'REVERSIBLE', 'CONSEQUENTIAL', 'DESTRUCTIVE', 'BULK', 'EXTERNAL'] as const;
export type Risk = (typeof RISKS)[number];

export type ConfirmReason = 'destructive' | 'bulk' | 'external' | 'untrusted_source' | 'inferred_value';
export type TaintSource = 'email' | 'calendar' | 'memory' | 'web';

// ───────────────────────── errors (§12) ─────────────────────────

export const ERROR_CODES = {
  INVALID_INPUT: { status: 400, retryable: false, message: "I couldn't read that request." },
  INPUT_TOO_LONG: { status: 413, retryable: false, message: "That's over 2,000 characters — try something shorter." },
  UNAUTHENTICATED: { status: 401, retryable: false, message: 'Please sign in again.' },
  RATE_LIMITED: { status: 429, retryable: true, message: "You've hit the command limit — try again in a minute." },
  REQUEST_IN_PROGRESS: { status: 409, retryable: true, message: 'Still working on that request.' },
  PROPOSAL_NOT_FOUND: { status: 404, retryable: false, message: 'That suggestion is no longer available.' },
  NOT_FOUND: { status: 404, retryable: false, message: "There's nothing to undo." },
  PROPOSAL_EXPIRED: { status: 410, retryable: false, message: 'That suggestion expired — ask again.' },
  CONFLICT: { status: 409, retryable: false, message: 'That task changed since I suggested this — ask again.' },
  POLICY_REJECTED: { status: 422, retryable: false, message: "I can't do that." },
  INTEGRATION_RECONNECT_REQUIRED: {
    status: 424,
    retryable: false,
    message: 'Your Google connection has expired — reconnect in Settings.',
  },
  PROVIDER_UNAVAILABLE: { status: 503, retryable: true, message: "Google isn't responding right now." },
  MODEL_ERROR: { status: 502, retryable: true, message: "I couldn't process that just now — try again." },
  INTERNAL: { status: 500, retryable: true, message: 'Something went wrong on our side.' },
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

// ───────────────────────── responses (§9.1) ─────────────────────────

export interface ClarificationOption {
  id: string;
  label: string;
  detail?: string;
}

export interface DiffLine {
  entity: string;
  field: string;
  before: string | null;
  after: string | null;
}

export interface ProposalView {
  id: string;
  tool: string;
  risk: Risk;
  summary: string;
  diff: DiffLine[];
  reasons: ConfirmReason[];
  taintSources?: TaintSource[];
  expiresAt: string;
}

export interface ExecutedAction {
  proposalId: string;
  tool: string;
  entity: { type: 'task' | 'reminder' | 'memory' | 'email_draft'; id: string };
  summary: string;
  undo?: { taskEventId: string; batchId?: string };
}

export interface AnswerSource {
  type: 'task' | 'event' | 'email' | 'memory' | 'web';
  label: string;
  href?: string;
}

/** Extra flag (not in the five kinds): a Google tool needed a reconnect during this run. */
interface Flags {
  needsReconnect?: true;
}

export type CommandResponse =
  | ({ kind: 'answer'; runId: string; message: string; sources?: AnswerSource[] } & Flags)
  | ({ kind: 'clarification'; runId: string; message: string; question: string; options: ClarificationOption[]; allowFreeText: boolean } & Flags)
  | ({ kind: 'proposal'; runId: string; message: string; proposal: ProposalView } & Flags)
  | ({ kind: 'executed'; runId: string; message: string; actions: ExecutedAction[] } & Flags)
  | ({ kind: 'error'; runId?: string; error: { code: ErrorCode; message: string; retryable: boolean; retryAfterMs?: number } } & Flags);

export function errorBody(
  code: ErrorCode,
  opts: { runId?: string; message?: string; retryAfterMs?: number; needsReconnect?: boolean } = {},
): Extract<CommandResponse, { kind: 'error' }> {
  const def = ERROR_CODES[code];
  return {
    kind: 'error',
    ...(opts.runId ? { runId: opts.runId } : {}),
    error: {
      code,
      message: opts.message ?? def.message,
      retryable: def.retryable,
      ...(opts.retryAfterMs !== undefined ? { retryAfterMs: opts.retryAfterMs } : {}),
    },
    ...(opts.needsReconnect ? { needsReconnect: true as const } : {}),
  };
}

/** HTTP status for a response body: 200 for the four success kinds, §12 for errors. */
export function statusFor(body: CommandResponse): number {
  return body.kind === 'error' ? ERROR_CODES[body.error.code].status : 200;
}

export function jsonResponse(body: CommandResponse): Response {
  return Response.json(body, { status: statusFor(body), headers: { 'Cache-Control': 'no-store' } });
}

// ───────────────────────── tool results (§5) ─────────────────────────

export type ProposalResult =
  | { status: 'executed'; proposalId: string; summary: string; alreadyInState?: boolean; deduped?: boolean }
  | { status: 'requires_confirmation'; proposalId: string; summary: string; reasons: ConfirmReason[] }
  | { status: 'needs_clarification'; question: string; options: ClarificationOption[] }
  | { status: 'rejected'; code: string; message: string };

/** Errors a tool can hand back to the model instead of throwing (§12, last paragraph). */
export type ToolErrorCode =
  | 'UNKNOWN_HANDLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INTEGRATION_RECONNECT_REQUIRED'
  | 'RATE_LIMITED'
  | 'CONTEXT_BUDGET'
  | 'UNTRUSTED_CONTEXT'
  | 'INVALID_INPUT'
  | 'NOT_FOUND';
