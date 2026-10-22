// components/command/speech.ts — what may be read aloud (FR-506).
// Results that involve email are summarised generically so subjects, senders
// and bodies are never spoken; everything else speaks the server's message.
import type { CommandResponse } from './api';

export function spokenSummary(r: CommandResponse): string | null {
  switch (r.kind) {
    case 'executed': {
      const touchesEmail = r.actions.some((a) => a.entity.type === 'email_draft');
      if (touchesEmail) return r.actions.length === 1 ? 'Done. The draft is saved in Gmail.' : `Done. ${r.actions.length} changes made.`;
      return r.message;
    }
    case 'answer':
      if (r.sources?.some((s) => s.type === 'email')) return `Found ${r.sources.length} result${r.sources.length === 1 ? '' : 's'}. They're on screen.`;
      return r.message;
    case 'clarification':
      return `${r.question} ${r.options.length} options are on screen.`;
    case 'proposal':
      return r.proposal.risk === 'EXTERNAL' || r.proposal.taintSources?.includes('email')
        ? 'This needs your confirmation. The details are on screen.'
        : `Confirmation needed: ${r.proposal.summary}`;
    case 'error':
      return r.error.message;
  }
}
