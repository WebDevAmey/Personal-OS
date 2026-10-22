// lib/commands/risk.ts — static risk class per tool plus escalators
// (docs/04 §6). Pure.
import type { Risk } from './types';

export type ProposalKind =
  | 'task.create'
  | 'task.update'
  | 'task.complete'
  | 'task.reopen'
  | 'task.snooze'
  | 'task.delete'
  | 'task.bulk'
  | 'reminder.create'
  | 'email.draft'
  | 'memory.save';

export const STATIC_RISK: Record<ProposalKind, Risk> = {
  'task.create': 'REVERSIBLE',
  'task.update': 'REVERSIBLE',
  'task.complete': 'REVERSIBLE',
  'task.reopen': 'REVERSIBLE',
  'task.snooze': 'REVERSIBLE',
  'task.delete': 'DESTRUCTIVE',
  'task.bulk': 'BULK',
  'reminder.create': 'REVERSIBLE',
  'email.draft': 'EXTERNAL',
  'memory.save': 'CONSEQUENTIAL',
};

/** Tool name the model calls → executor kind. */
export const TOOL_KIND: Record<string, ProposalKind> = {
  propose_create_task: 'task.create',
  propose_update_task: 'task.update',
  propose_complete_task: 'task.complete',
  propose_reopen_task: 'task.reopen',
  propose_snooze_task: 'task.snooze',
  propose_delete_task: 'task.delete',
  propose_bulk_update_tasks: 'task.bulk',
  propose_create_reminder: 'reminder.create',
  propose_email_draft: 'email.draft',
  save_memory: 'memory.save',
};

export const KIND_TOOL: Record<ProposalKind, string> = Object.fromEntries(
  Object.entries(TOOL_KIND).map(([tool, kind]) => [kind, tool]),
) as Record<ProposalKind, string>;

export interface RiskInput {
  kind: ProposalKind;
  targetCount: number;
  /** Update clears a non-empty description or removes a due date. */
  clearsContent?: boolean;
}

export function classifyRisk(input: RiskInput): Risk {
  const base = STATIC_RISK[input.kind];
  if (input.targetCount > 1) return 'BULK';
  if (base === 'REVERSIBLE' && input.clearsContent) return 'CONSEQUENTIAL';
  return base;
}
