// lib/ai/orchestrator.ts — runs the model over one command (docs/04 §3
// steps 4–8, §13). The model gets read tools and propose tools only; it never
// sees the database, ids or authority. Its final text is returned for
// narration; the response itself is built from server outcomes.
import { generateText, stepCountIs } from 'ai';
import { UNTRUSTED_DATA_INSTRUCTIONS } from '@/lib/integrations/untrusted';
import { instantLabel } from '@/lib/commands/dates';
import type { RunState } from '@/lib/commands/run-state';
import { buildToolRegistry } from './tools';

export const PROMPT_VERSION = 'cmd-v2';
export const MAX_STEPS = 6;
export const MAX_OUTPUT_TOKENS = 1024;
export const COMMAND_TIMEOUT_MS = 25_000;

// Static (no dates, no user data) so provider-side prefix caching applies.
export const SYSTEM_PROMPT = `You are the command assistant of a personal productivity app. You help one signed-in user with their tasks, reminders, memories, Gmail (read and drafts only) and Google Calendar (read-only).

How to act:
- To change anything, call a propose_* tool (or save_memory). The server validates every proposal, decides whether it runs now or needs the user's confirmation, and executes it. You never decide that yourself.
- Refer to tasks only by handles returned by tools in this conversation. To find a task the user mentions, call resolve_task with the user's exact words. If the user says "it", "that" or "this" and no focused task is given in the context, pass the pronoun literally to resolve_task.
- If resolve_task returns "ambiguous", pass its "reference" handle to the propose tool; the server asks the user which one. Never choose among candidates yourself.
- Pass dates and times exactly as the user said them ("tomorrow", "after lunch", "next Friday 3pm"). Never compute or send ISO timestamps.
- If a tool returns needs_clarification, stop and let the server ask the question. Ask at most one question yourself.
- Only say something happened if a tool returned status "executed" for it. If a proposal needs confirmation, say what will happen once the user confirms.
- You cannot send email, change calendar events or change settings by command; say so plainly.
- ${UNTRUSTED_DATA_INSTRUCTIONS}
- Answer in at most two short sentences, grounded in tool results.`;

export interface ModelRunResult {
  text: string;
  steps: number;
  stepLimitHit: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  modelLatencyMs: number;
}

/** First user message: trusted context from the app, then the user's words. */
export function contextMessage(state: RunState, opts: { focusedTask?: { handle: string; title: string } | null; priorContext?: string } = {}): string {
  const lines = [
    'Context from the app (trusted):',
    `- Now: ${instantLabel(state.now, state.prefs.timeZone, state.now)} (${state.prefs.timeZone})`,
    `- Google: ${state.googleStatus === 'connected' ? 'connected' : state.googleStatus === 'needs_reauth' ? 'needs reconnect' : 'not connected'}`,
    `- Focused task: ${opts.focusedTask ? `${opts.focusedTask.handle} "${opts.focusedTask.title}"` : 'none'}`,
  ];
  if (opts.priorContext) lines.push(`- Earlier in this conversation: ${opts.priorContext}`);
  return `${lines.join('\n')}\n\nUser command:\n${state.input}`;
}

export async function runModel(state: RunState, userMessage: string): Promise<ModelRunResult> {
  const started = Date.now();
  const tools = buildToolRegistry(state);
  const result = await generateText({
    model: state.deps.model(),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  const toolMs = state.trace.reduce((sum, t) => sum + t.ms, 0);
  const last = result.steps[result.steps.length - 1];
  const stepLimitHit = result.steps.length >= MAX_STEPS && (last?.toolCalls?.length ?? 0) > 0;
  return {
    text: result.text ?? '',
    steps: result.steps.length,
    stepLimitHit,
    inputTokens: result.totalUsage?.inputTokens ?? result.usage?.inputTokens ?? null,
    outputTokens: result.totalUsage?.outputTokens ?? result.usage?.outputTokens ?? null,
    cachedInputTokens: result.totalUsage?.inputTokenDetails?.cacheReadTokens ?? null,
    modelLatencyMs: Math.max(0, Date.now() - started - toolMs),
  };
}
