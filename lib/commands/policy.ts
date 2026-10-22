// lib/commands/policy.ts — the confirmation policy (docs/04 §8.4, ADR-007).
// Pure: no I/O, no clock, no model. The model never decides whether an action
// is authorised; this function does.
import type { ConfirmReason, Risk } from './types';

export const BULK_TARGET_LIMIT = 50;
export const MAX_DRAFT_RECIPIENTS = 10;

export type Resolution = 'unique' | 'ambiguous' | 'none' | 'not_applicable';

export interface PolicyInput {
  risk: Risk;
  /** Existing entities the action changes (0 for creates). */
  targetCount: number;
  tainted: boolean;
  /** How the target entity was resolved. Anything but unique/not_applicable cannot execute. */
  resolution: Resolution;
  /** Values the server inferred or defaulted and must show the user (`defaulted_time`, `dst_shifted`). */
  inferredFields: string[];
  /** Email drafts only. */
  recipientCount?: number;
  /** Defence in depth: false when any target id is not owned by the user. */
  allTargetsOwned?: boolean;
  /** The proposal is past `expiresAt`. */
  expired?: boolean;
}

export type PolicyDecision =
  | { decision: 'auto'; reasons: ConfirmReason[]; note?: 'inferred_value' }
  | { decision: 'confirm'; reasons: ConfirmReason[] }
  | { decision: 'reject'; code: 'BULK_LIMIT' | 'TOO_MANY_RECIPIENTS' | 'NOT_OWNED' | 'EXPIRED' | 'UNRESOLVED'; message: string };

const STATIC_REASON: Partial<Record<Risk, ConfirmReason>> = {
  DESTRUCTIVE: 'destructive',
  BULK: 'bulk',
  EXTERNAL: 'external',
};

export function decide(input: PolicyInput): PolicyDecision {
  // Hard rejects: never executable, even with confirmation.
  if (input.expired) return { decision: 'reject', code: 'EXPIRED', message: 'That suggestion expired — ask again.' };
  if (input.allTargetsOwned === false) return { decision: 'reject', code: 'NOT_OWNED', message: 'That item is not available.' };
  if (input.targetCount > BULK_TARGET_LIMIT) {
    return { decision: 'reject', code: 'BULK_LIMIT', message: `I can change at most ${BULK_TARGET_LIMIT} tasks at once.` };
  }
  if (input.risk === 'EXTERNAL' && (input.recipientCount ?? 0) > MAX_DRAFT_RECIPIENTS) {
    return { decision: 'reject', code: 'TOO_MANY_RECIPIENTS', message: `A draft can have at most ${MAX_DRAFT_RECIPIENTS} recipients.` };
  }
  if (input.resolution === 'ambiguous' || input.resolution === 'none') {
    return { decision: 'reject', code: 'UNRESOLVED', message: 'Which item did you mean?' };
  }

  // Any proposal touching more than one existing entity is BULK.
  const risk: Risk = input.targetCount > 1 && input.risk !== 'READ' ? 'BULK' : input.risk;
  const inferred = input.inferredFields.length > 0;

  if (risk === 'READ') return { decision: 'auto', reasons: [] };

  const reasons: ConfirmReason[] = [];
  const staticReason = STATIC_REASON[risk];
  if (staticReason) reasons.push(staticReason);
  if (input.tainted) reasons.push('untrusted_source');

  switch (risk) {
    case 'REVERSIBLE':
      if (input.tainted) return { decision: 'confirm', reasons };
      return inferred ? { decision: 'auto', reasons: [], note: 'inferred_value' } : { decision: 'auto', reasons: [] };
    case 'CONSEQUENTIAL':
      if (input.tainted) return { decision: 'confirm', reasons };
      if (inferred) return { decision: 'confirm', reasons: [...reasons, 'inferred_value'] };
      return { decision: 'auto', reasons: [] };
    case 'DESTRUCTIVE':
    case 'BULK':
    case 'EXTERNAL':
      return { decision: 'confirm', reasons: inferred ? [...reasons, 'inferred_value'] : reasons };
  }
}
