// components/command/state.ts — the palette's state machine (docs/00 §4.2,
// docs/07 §11.1). Pure, so every transition is unit-testable.
//
//   idle ──submit──▶ pending ──▶ clarification | proposal | executed | answer | error
//   clarification ──pick/rephrase──▶ pending        proposal ──confirm/cancel──▶ pending
//   error ──retry (same clientRequestId)──▶ pending     any ──reset──▶ idle
import type { CommandRequest, CommandResponse, ConfirmRequest } from './api';

export type LastRequest = { type: 'command'; req: CommandRequest } | { type: 'confirm'; req: ConfirmRequest };

export type PaletteStatus = 'idle' | 'pending' | 'clarification' | 'proposal' | 'executed' | 'answer' | 'error';

export interface PaletteState {
  status: PaletteStatus;
  /** The text in the input. Kept through pending/clarification so nothing is lost. */
  input: string;
  /** What the pending request is doing, for the status line. */
  pendingLabel: string | null;
  response: CommandResponse | null;
  /** The clarification that the current reply answers, if any. */
  clarification: Extract<CommandResponse, { kind: 'clarification' }> | null;
  last: LastRequest | null;
  /** proposalIds whose executed action was undone. */
  undone: string[];
  /** Last run that changed something: lets "it"/"that" refer back (docs/04 §8.2). */
  previousRunId: string | null;
}

export const initialPaletteState: PaletteState = {
  status: 'idle',
  input: '',
  pendingLabel: null,
  response: null,
  clarification: null,
  last: null,
  undone: [],
  previousRunId: null,
};

export type PaletteAction =
  | { type: 'input'; value: string }
  | { type: 'submit'; request: LastRequest; label: string }
  | { type: 'result'; response: CommandResponse }
  | { type: 'undone'; proposalId: string }
  | { type: 'reset'; keepInput?: boolean };

function statusOf(r: CommandResponse): PaletteStatus {
  return r.kind === 'executed' ? 'executed' : r.kind;
}

export function paletteReducer(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case 'input':
      // Typing after a terminal state starts a new command; a clarification
      // stays open so free text can answer it.
      if (state.status === 'pending') return state;
      if (state.status === 'clarification') return { ...state, input: action.value };
      return { ...state, input: action.value, status: 'idle', response: null };
    case 'submit':
      return {
        ...state,
        status: 'pending',
        pendingLabel: action.label,
        last: action.request,
        clarification: state.status === 'clarification' && state.response?.kind === 'clarification' ? state.response : state.clarification,
      };
    case 'result': {
      const r = action.response;
      const next: PaletteState = { ...state, status: statusOf(r), response: r, pendingLabel: null, undone: [] };
      if (r.kind === 'clarification') next.clarification = r;
      else next.clarification = null;
      if (r.kind === 'executed') {
        next.previousRunId = r.runId;
        next.input = '';
      }
      return next;
    }
    case 'undone':
      return state.undone.includes(action.proposalId) ? state : { ...state, undone: [...state.undone, action.proposalId] };
    case 'reset':
      return { ...initialPaletteState, previousRunId: state.previousRunId, input: action.keepInput ? state.input : '' };
  }
}

/** Builds the next /api/command request for free text (optionally replying to a clarification). */
export function commandRequestFor(
  state: PaletteState,
  input: string,
  opts: { clientRequestId: string; source: 'typed' | 'voice'; focusedTaskId?: string; page?: 'today' | 'tasks' | 'other' },
): CommandRequest {
  const clar = state.status === 'clarification' && state.response?.kind === 'clarification' && state.response.allowFreeText ? state.response : null;
  return {
    clientRequestId: opts.clientRequestId,
    input: input.trim(),
    source: opts.source,
    ...(clar ? { replyTo: { runId: clar.runId } } : {}),
    context: {
      ...(opts.focusedTaskId ? { focusedTaskId: opts.focusedTaskId } : {}),
      ...(opts.page ? { page: opts.page } : {}),
      ...(state.previousRunId ? { previousRunId: state.previousRunId } : {}),
    },
  };
}
