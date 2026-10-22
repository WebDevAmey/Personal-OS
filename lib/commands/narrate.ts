// lib/commands/narrate.ts — builds the response envelope from server
// outcomes and keeps the model's text truthful (docs/04 §10.3). The
// structured parts (proposal, actions, options) only ever come from server
// state; the model's words fill `message` only when they don't claim
// something the server didn't do.
import type { Outcome, RunState } from './run-state';
import type { CommandResponse, ExecutedAction } from './types';
import { errorBody } from './types';

const COMPLETION_CLAIM = /\b(moved|created|added|deleted|removed|done|completed|drafted|saved|remembered|reminded|snoozed|reopened|updated|rescheduled|postponed|marked|set)\b/i;

const PAST: [RegExp, string][] = [
  [/^Move /, 'Moved '],
  [/^Add /, 'Added '],
  [/^Update /, 'Updated '],
  [/^Complete /, 'Completed '],
  [/^Reopen /, 'Reopened '],
  [/^Delete /, 'Deleted '],
  [/^Snooze /, 'Snoozed '],
  [/^Remove /, 'Removed '],
  [/^Remind you /, "I'll remind you "],
  [/^Remember: /, 'Saved to memory: '],
  [/^Draft an email /, 'Saved a Gmail draft '],
];

export function pastTense(summary: string): string {
  for (const [re, repl] of PAST) if (re.test(summary)) return summary.replace(re, repl);
  return `Done: ${summary}`;
}

export function executedMessage(actions: ExecutedAction[]): string {
  return actions.map((a) => `${pastTense(a.summary)}.`).join(' ');
}

/** Model text, unless it claims a completed action the server did not execute. */
export function truthful(text: string, executedCount: number): string | null {
  const t = text.trim();
  if (!t) return null;
  if (executedCount === 0 && COMPLETION_CLAIM.test(t)) return null;
  return t.length > 1200 ? `${t.slice(0, 1199)}…` : t;
}

export interface BuildOptions {
  modelText: string;
  stepLimitHit?: boolean;
}

export function buildResponse(state: RunState, opts: BuildOptions): CommandResponse {
  const runId = state.runId;
  const flags = state.needsReconnect ? { needsReconnect: true as const } : {};
  const executed = state.outcomes.filter((o): o is Extract<Outcome, { kind: 'executed' }> => o.kind === 'executed');
  const proposals = state.outcomes.filter((o): o is Extract<Outcome, { kind: 'proposal' }> => o.kind === 'proposal');
  const clarification = state.outcomes.find((o): o is Extract<Outcome, { kind: 'clarification' }> => o.kind === 'clarification');
  const rejected = state.outcomes.filter((o): o is Extract<Outcome, { kind: 'rejected' }> => o.kind === 'rejected');
  const actions = executed.map((e) => e.action);
  const doneText = actions.length ? `${executedMessage(actions)} ` : '';
  const stopped = opts.stepLimitHit ? ' I stopped before finishing.' : '';

  if (clarification) {
    return {
      kind: 'clarification',
      runId,
      message: `${doneText}${clarification.message}`,
      question: clarification.question,
      options: clarification.options,
      allowFreeText: clarification.allowFreeText,
      ...flags,
    };
  }
  if (proposals.length) {
    const p = proposals[0].proposal;
    const more = proposals.length > 1 ? ` (${proposals.length - 1} more waiting)` : '';
    const model = truthful(opts.modelText, actions.length);
    return {
      kind: 'proposal',
      runId,
      message: `${doneText}${model && actions.length === 0 ? model : `Please confirm: ${p.summary}.`}${more}${stopped}`,
      proposal: p,
      ...flags,
    };
  }
  if (actions.length) {
    const model = truthful(opts.modelText, actions.length);
    return { kind: 'executed', runId, message: `${model ?? executedMessage(actions)}${stopped}`, actions, ...flags };
  }
  const policy = rejected.find((r) => r.policy);
  if (policy) return errorBody('POLICY_REJECTED', { runId, message: policy.message, needsReconnect: state.needsReconnect });

  const model = truthful(opts.modelText, 0);
  if (!model && state.needsReconnect) return errorBody('INTEGRATION_RECONNECT_REQUIRED', { runId, needsReconnect: true });
  const fallback = rejected[0]?.message ?? (opts.modelText.trim() ? "I haven't changed anything." : "I'm not sure how to help with that.");
  return {
    kind: 'answer',
    runId,
    message: `${model ?? fallback}${stopped}`,
    ...(state.sources.length ? { sources: dedupeSources(state.sources) } : {}),
    ...flags,
  };
}

function dedupeSources(sources: RunState['sources']): RunState['sources'] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const k = `${s.type}:${s.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 10);
}
