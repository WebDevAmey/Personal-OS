// lib/commands/repo.ts — ownership-scoped persistence for the command
// pipeline: AgentRun, ProposedAction, AgentAction (docs/03 §2, ADR-006).
// Every query filters by userId; another user's ids behave like missing ones.
import { type Tx, isUniqueViolation, reader } from '@/lib/db/tx';
import type {
  AgentRun,
  AgentRunStatus,
  InputModality,
  Prisma,
  ProposalStatus,
  ProposedAction,
  RiskClass,
} from '@/lib/generated/prisma/client';
import { redact } from '@/lib/observability/logger';

export type { AgentRun, ProposedAction };

export const STALE_RUN_MS = 60_000;
export const PROPOSAL_TTL_MS = 15 * 60_000;

// ───────────────────────── AgentRun ─────────────────────────

export type ClaimResult =
  | { state: 'new'; run: AgentRun }
  | { state: 'finished'; run: AgentRun }
  | { state: 'running'; run: AgentRun };

export async function findRunByRequestId(userId: string, clientRequestId: string): Promise<AgentRun | null> {
  return reader().agentRun.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId } } });
}

/**
 * Claims `clientRequestId` for this user. A concurrent duplicate loses the
 * unique constraint and gets the existing run back (replay / in progress).
 */
export async function claimRun(
  userId: string,
  data: { clientRequestId: string; input: string; modality: InputModality; clarifiesRunId?: string | null; requestId?: string; model?: string; promptVersion?: string },
): Promise<ClaimResult> {
  try {
    const run = await reader().agentRun.create({
      data: {
        userId,
        clientRequestId: data.clientRequestId,
        input: data.input,
        modality: data.modality,
        clarifiesRunId: data.clarifiesRunId ?? null,
        requestId: data.requestId ?? null,
        model: data.model ?? null,
        promptVersion: data.promptVersion ?? null,
        status: 'RUNNING',
      },
    });
    return { state: 'new', run };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const run = await findRunByRequestId(userId, data.clientRequestId);
    if (!run) throw e;
    return run.status === 'RUNNING' ? { state: 'running', run } : { state: 'finished', run };
  }
}

/** Re-opens a FAILED run so a retry with the same clientRequestId can run again. CAS on status. */
export async function reclaimFailedRun(userId: string, runId: string): Promise<boolean> {
  const res = await reader().agentRun.updateMany({
    where: { id: runId, userId, status: 'FAILED' },
    data: { status: 'RUNNING', errorCode: null, finishedAt: null },
  });
  return res.count === 1;
}

/** Marks a RUNNING run older than STALE_RUN_MS as FAILED (abandoned). */
export async function failStaleRun(userId: string, runId: string, now: Date, result: Prisma.InputJsonValue): Promise<boolean> {
  const res = await reader().agentRun.updateMany({
    where: { id: runId, userId, status: 'RUNNING', createdAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    data: { status: 'FAILED', errorCode: 'STALE_RUN', result, finishedAt: now },
  });
  return res.count === 1;
}

export interface RunOutcome {
  status: AgentRunStatus;
  result: Prisma.InputJsonValue;
  intent?: string | null;
  errorCode?: string | null;
  stepCount?: number | null;
  toolCalls?: Prisma.InputJsonValue;
  toolTrace?: Prisma.InputJsonValue;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  tokenCost?: number | null;
  model?: string | null;
  finishedAt: Date;
}

export async function finishRun(userId: string, runId: string, outcome: RunOutcome): Promise<void> {
  await reader().agentRun.updateMany({ where: { id: runId, userId }, data: outcome });
}

export async function getRun(userId: string, runId: string): Promise<AgentRun | null> {
  return reader().agentRun.findFirst({ where: { id: runId, userId } });
}

// ───────────────────────── ProposedAction ─────────────────────────

export interface NewProposal {
  /** Caller-chosen id (email drafts need it before insert for the Message-ID). */
  id?: string;
  agentRunId: string;
  kind: string;
  args: Prisma.InputJsonValue;
  summary: string;
  diff?: Prisma.InputJsonValue;
  risk: RiskClass;
  targetIds?: string[];
  targetVersions?: Prisma.InputJsonValue;
  tainted?: boolean;
  untrustedSources?: string[];
  requiresConfirmation?: boolean;
  confirmationReason?: string | null;
  status: ProposalStatus;
  expiresAt: Date;
}

export async function createProposal(userId: string, p: NewProposal, opts: { tx?: Tx } = {}): Promise<ProposedAction> {
  return reader(opts.tx).proposedAction.create({ data: { userId, ...p, targetIds: p.targetIds ?? [], untrustedSources: p.untrustedSources ?? [] } });
}

export async function getProposal(userId: string, id: string, opts: { tx?: Tx } = {}): Promise<ProposedAction | null> {
  if (typeof id !== 'string' || id.length === 0) return null;
  return reader(opts.tx).proposedAction.findFirst({ where: { id, userId } });
}

export async function listRunProposals(userId: string, agentRunId: string): Promise<ProposedAction[]> {
  return reader().proposedAction.findMany({ where: { userId, agentRunId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** Compare-and-set on status. Returns true when this caller made the transition. */
export async function transitionProposal(
  userId: string,
  id: string,
  from: ProposalStatus | ProposalStatus[],
  to: ProposalStatus,
  data: Prisma.ProposedActionUpdateManyMutationInput = {},
  opts: { tx?: Tx; notExpiredAt?: Date } = {},
): Promise<boolean> {
  const res = await reader(opts.tx).proposedAction.updateMany({
    where: {
      id,
      userId,
      status: Array.isArray(from) ? { in: from } : from,
      ...(opts.notExpiredAt ? { expiresAt: { gt: opts.notExpiredAt } } : {}),
    },
    data: { ...data, status: to },
  });
  return res.count === 1;
}

export async function updateProposal(userId: string, id: string, data: Prisma.ProposedActionUpdateManyMutationInput, opts: { tx?: Tx } = {}): Promise<void> {
  await reader(opts.tx).proposedAction.updateMany({ where: { id, userId }, data });
}

/** Expires every still-open proposal of a run (used when the run fails). */
export async function expireRunProposals(userId: string, agentRunId: string): Promise<number> {
  const res = await reader().proposedAction.updateMany({
    where: { userId, agentRunId, status: { in: ['PENDING', 'NEEDS_CLARIFICATION'] } },
    data: { status: 'EXPIRED' },
  });
  return res.count;
}

/** Proposals the user's previous run executed (antecedent for "it", docs/04 §8.2). */
export async function executedTargetsOfRun(userId: string, agentRunId: string): Promise<string[]> {
  const rows = await reader().proposedAction.findMany({
    where: { userId, agentRunId, status: 'EXECUTED' },
    select: { targetIds: true, result: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    for (const id of r.targetIds) ids.add(id);
    // Executed proposals store `{ action: ExecutedAction }` (lib/commands/execute.ts).
    const created = (r.result as { action?: { entity?: { type?: string; id?: string } } } | null)?.action?.entity;
    if (created?.type === 'task' && created.id) ids.add(created.id);
  }
  return [...ids];
}

// ───────────────────────── AgentAction (audit of tool calls) ─────────────────────────

export interface ToolCallRecord {
  agentRunId: string;
  proposedActionId?: string | null;
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
  status: 'SUCCESS' | 'ERROR';
  durationMs: number;
}

export async function recordToolCall(userId: string, r: ToolCallRecord): Promise<void> {
  try {
    await reader().agentAction.create({
      data: {
        userId,
        agentRunId: r.agentRunId,
        proposedActionId: r.proposedActionId ?? null,
        toolName: r.toolName,
        input: redact(r.input) as Prisma.InputJsonValue,
        output: redact(r.output) as Prisma.InputJsonValue,
        idempotencyKey: `${r.agentRunId}:${r.toolCallId}`,
        status: r.status,
        durationMs: r.durationMs,
      },
    });
  } catch (e) {
    // The same tool call recorded twice (model retry with the same id) is harmless.
    if (!isUniqueViolation(e)) throw e;
  }
}

export async function listRunToolCalls(userId: string, agentRunId: string) {
  return reader().agentAction.findMany({ where: { userId, agentRunId }, orderBy: { createdAt: 'asc' } });
}

// ───────────────────────── integrations (existence only) ─────────────────────────

/** Whether the user has a usable Google row. Never reads token columns. */
export async function googleConnection(userId: string): Promise<'connected' | 'needs_reauth' | 'none'> {
  const row = await reader().integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: 'google' } },
    select: { status: true },
  });
  if (!row || row.status === 'DISCONNECTED') return 'none';
  return row.status === 'NEEDS_REAUTH' ? 'needs_reauth' : 'connected';
}

/** onNeedsReconnect callback: flag the grant so the UI shows "Reconnect Google". */
export async function markGoogleNeedsReauth(userId: string, now = new Date()): Promise<void> {
  await reader().integrationAccount.updateMany({
    where: { userId, provider: 'google' },
    data: { status: 'NEEDS_REAUTH', lastErrorCode: 'NEEDS_RECONNECT', lastErrorAt: now },
  });
}
