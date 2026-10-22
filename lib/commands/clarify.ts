// lib/commands/clarify.ts — answering a clarification (docs/04 §8.1).
// The client sends { replyTo: { runId, optionId } }; the stored
// NEEDS_CLARIFICATION proposal is claimed once (CAS → CANCELLED), its open
// slot is filled from the option, and the pipeline resumes at step 8
// without calling the model.
import { updatePreferences } from '@/lib/preferences/repo';
import type { ProposedAction } from '@/lib/generated/prisma/client';
import { processDraft, type ClarificationArgs, type Draft } from './proposals';
import { listRunProposals, recordToolCall, transitionProposal } from './repo';
import { cleanReference } from './resolve-task';
import type { RunState } from './run-state';
import type { ErrorCode } from './types';

export type ResumeResult =
  | { ok: true; kind: 'resumed'; lunchSaved?: string }
  | { ok: true; kind: 'reenter'; input: string }
  | { ok: false; code: ErrorCode };

export async function openClarification(userId: string, runId: string): Promise<ProposedAction | null> {
  const rows = await listRunProposals(userId, runId);
  return [...rows].reverse().find((r) => r.status === 'NEEDS_CLARIFICATION') ?? null;
}

export async function resumeClarification(state: RunState, priorRunId: string, optionId: string): Promise<ResumeResult> {
  const row = await openClarification(state.userId, priorRunId);
  if (!row) {
    const any = (await listRunProposals(state.userId, priorRunId)).length > 0;
    return { ok: false, code: any ? 'PROPOSAL_EXPIRED' : 'PROPOSAL_NOT_FOUND' };
  }
  if (row.expiresAt <= state.now) {
    await transitionProposal(state.userId, row.id, 'NEEDS_CLARIFICATION', 'EXPIRED');
    return { ok: false, code: 'PROPOSAL_EXPIRED' };
  }
  const args = row.args as unknown as ClarificationArgs;
  const option = args.options.find((o) => o.id === optionId);
  if (!option) return { ok: false, code: 'INVALID_INPUT' };
  // Claim the clarification once; a second pick gets PROPOSAL_EXPIRED.
  const claimed = await transitionProposal(state.userId, row.id, 'NEEDS_CLARIFICATION', 'CANCELLED', { result: { answeredWith: optionId, byRunId: state.runId } });
  if (!claimed) return { ok: false, code: 'PROPOSAL_EXPIRED' };

  const draft: Draft = structuredClone(args.draft);
  draft.originalInput = args.originalInput;
  // The user's original words remain the taint baseline for the resumed draft.
  state.input = args.originalInput;

  if (args.slot === 'task') {
    const taskId = String(option.value);
    if (draft.kind === 'resolve') {
      state.pinned.set(cleanReference(draft.reference ?? ''), taskId);
      return { ok: true, kind: 'reenter', input: args.originalInput };
    }
    draft.target = { taskId };
  } else if (args.slot.startsWith('date:')) {
    const key = args.slot.slice('date:'.length);
    const v = option.value as { instant: string; hasTime: boolean; localDate: string; label: string };
    draft.dates[key] = { resolved: { instant: v.instant, hasTime: v.hasTime, localDate: v.localDate, label: v.label } };
  } else if (args.slot.startsWith('pref:lunchEndsAt:')) {
    const value = String(option.value);
    const started = Date.now();
    await updatePreferences(state.userId, { lunchEndsAt: value }, { actorType: 'AGENT', agentRunId: state.runId, requestId: state.requestId });
    state.prefs = { ...state.prefs, lunchEndsAt: value };
    await recordToolCall(state.userId, {
      agentRunId: state.runId,
      toolName: 'set_preference',
      toolCallId: `clarify:${row.id}`,
      input: { lunchEndsAt: value },
      output: { status: 'saved' },
      status: 'SUCCESS',
      durationMs: Date.now() - started,
    });
    await processDraft(state, draft);
    return { ok: true, kind: 'resumed', lunchSaved: value };
  } else {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  await processDraft(state, draft);
  return { ok: true, kind: 'resumed' };
}
