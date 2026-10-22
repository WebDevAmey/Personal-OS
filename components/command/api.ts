// components/command/api.ts — typed client for the command pipeline,
// mirroring docs/04 §9 exactly (POST /api/command, POST /api/command/confirm).
//
// Idempotency (docs/04 §11.1): one clientRequestId per submission, reused for
// automatic retries of that same submission (network failure, 5xx marked
// retryable, 409 REQUEST_IN_PROGRESS after retryAfterMs). A new submission —
// including answering a clarification — gets a new id.

export type Risk = 'READ' | 'REVERSIBLE' | 'CONSEQUENTIAL' | 'DESTRUCTIVE' | 'BULK' | 'EXTERNAL';

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INPUT_TOO_LONG'
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  | 'REQUEST_IN_PROGRESS'
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_EXPIRED'
  | 'CONFLICT'
  | 'POLICY_REJECTED'
  | 'INTEGRATION_RECONNECT_REQUIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'MODEL_ERROR'
  | 'STEP_LIMIT'
  | 'INTERNAL'
  /** Client-side only: the request never got a response. */
  | 'NETWORK';

export interface CommandRequest {
  clientRequestId: string;
  input?: string;
  replyTo?: { runId: string; optionId?: string };
  source?: 'typed' | 'voice';
  context?: { focusedTaskId?: string; page?: 'today' | 'tasks' | 'other'; previousRunId?: string };
}

export interface AnswerSource {
  type: 'task' | 'event' | 'email' | 'memory' | 'web';
  label: string;
  href?: string;
}

export interface ClarificationOption {
  id: string;
  label: string;
  detail?: string;
}

export interface ProposalDiff {
  entity: string;
  field: string;
  before: string | null;
  after: string | null;
}

export type ProposalReason = 'destructive' | 'bulk' | 'external' | 'untrusted_source' | 'inferred_value';

export interface Proposal {
  id: string;
  tool: string;
  risk: Risk;
  summary: string;
  diff: ProposalDiff[];
  reasons: ProposalReason[];
  taintSources?: ('email' | 'calendar' | 'memory' | 'web')[];
  expiresAt: string;
}

export interface ExecutedAction {
  proposalId: string;
  tool: string;
  entity: { type: 'task' | 'reminder' | 'memory' | 'email_draft'; id: string };
  summary: string;
  undo?: { taskEventId: string };
}

export type CommandResponse =
  | { kind: 'answer'; runId: string; message: string; sources?: AnswerSource[] }
  | { kind: 'clarification'; runId: string; message: string; question: string; options: ClarificationOption[]; allowFreeText: boolean }
  | { kind: 'proposal'; runId: string; message: string; proposal: Proposal }
  | { kind: 'executed'; runId: string; message: string; actions: ExecutedAction[] }
  | { kind: 'error'; runId?: string; error: { code: ErrorCode; message: string; retryable: boolean; retryAfterMs?: number } };

export interface ConfirmRequest {
  proposalId: string;
  decision?: 'confirm' | 'cancel';
}

export type CommandError = Extract<CommandResponse, { kind: 'error' }>;

const KINDS = new Set(['answer', 'clarification', 'proposal', 'executed', 'error']);

function isCommandResponse(v: unknown): v is CommandResponse {
  return typeof v === 'object' && v !== null && KINDS.has((v as { kind?: string }).kind ?? '');
}

export function newClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 from getRandomValues (older Safari).
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  NETWORK: "Couldn't reach Personal OS. Check your connection and retry.",
  RATE_LIMITED: "You've hit the command limit — try again in a minute.",
  UNAUTHENTICATED: 'Please sign in again.',
  INTERNAL: 'Something went wrong on our side.',
};

function errorFrom(status: number, body: unknown): CommandError {
  if (isCommandResponse(body) && body.kind === 'error') return body;
  const code: ErrorCode = status === 401 ? 'UNAUTHENTICATED' : status === 429 ? 'RATE_LIMITED' : status === 413 ? 'INPUT_TOO_LONG' : 'INTERNAL';
  return { kind: 'error', error: { code, message: ERROR_COPY[code] ?? 'Something went wrong on our side.', retryable: status >= 500 || status === 429 } };
}

export interface SendOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Automatic retries of the same submission (same clientRequestId). */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function post(url: string, payload: unknown, opts: SendOptions): Promise<CommandResponse> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const max = opts.maxRetries ?? 2;
  let last: CommandResponse | null = null;
  for (let attempt = 0; attempt <= max; attempt++) {
    let res: Response;
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      last = { kind: 'error', error: { code: 'NETWORK', message: ERROR_COPY.NETWORK!, retryable: true } };
      if (attempt < max) await sleep(400 * 2 ** attempt);
      continue;
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const parsed = res.ok && isCommandResponse(body) ? body : errorFrom(res.status, body);
    if (parsed.kind !== 'error') return parsed;
    last = parsed;
    // Only silent retries for the in-progress / transient cases; anything
    // else (incl. rate limiting) is shown to the user, who can press Retry.
    const transient = parsed.error.code === 'REQUEST_IN_PROGRESS' || (parsed.error.retryable && res.status >= 500 && parsed.error.code !== 'RATE_LIMITED');
    if (!transient || attempt === max) return parsed;
    await sleep(parsed.error.retryAfterMs ?? 500 * 2 ** attempt);
  }
  return last!;
}

/** POST /api/command. Pass the same `clientRequestId` to retry the same submission. */
export function sendCommand(req: CommandRequest, opts: SendOptions = {}): Promise<CommandResponse> {
  return post('/api/command', req, opts);
}

/** POST /api/command/confirm. Idempotent on proposalId (docs/04 §9.2). */
export function confirmProposal(req: ConfirmRequest, opts: SendOptions = {}): Promise<CommandResponse> {
  return post('/api/command/confirm', { proposalId: req.proposalId, decision: req.decision ?? 'confirm' }, opts);
}
