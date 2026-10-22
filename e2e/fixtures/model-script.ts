// e2e/fixtures/model-script.ts — what the E2E scripted model "says".
//
// The scripted model (lib/ai/scripted-model.ts, test-only, see its gate in
// lib/env.ts) replaces the LLM in Playwright runs. It maps known command
// phrases to sequences of REAL tool calls (lib/ai/tools), so the real tool
// registry, resolver, policy, proposals, DB transactions and UI all run; only
// the language model is fake. Briefing requests get items built from the
// task facts the real briefing prompt contains (lib/briefing/generate.ts).
//
// Pure data and functions: no app imports, so it is safe to load anywhere.

export interface ScriptToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface ScriptToolResult {
  toolName: string;
  /** JSON value, or the raw string for text results (untrusted blocks). */
  value: unknown;
  /** Serialised form, for handle lookups. */
  text: string;
}

export interface ScriptStepContext {
  /** The user's command (the text after "User command:"). */
  input: string;
  /** Regex groups of the matched phrase. */
  match: RegExpMatchArray;
  /** Results of the previous step's tool calls. */
  results: ScriptToolResult[];
}

export type ScriptStep = ScriptToolCall[] | string | ((ctx: ScriptStepContext) => ScriptToolCall[] | string);

export interface CommandScript {
  phrase: RegExp;
  steps: ScriptStep[];
}

export const UNKNOWN_COMMAND_REPLY = 'The test model only knows the scripted E2E phrases.';

function firstHandle(results: ScriptToolResult[], prefix: string): string | null {
  for (const r of results) {
    const m = r.text.match(new RegExp(`${prefix}[a-z2-7]{10}`));
    if (m) return m[0];
  }
  return null;
}

/** After resolve_task: the unique task's handle, or the ambiguous set's `reference` handle. */
function resolvedTarget(results: ScriptToolResult[]): string | null {
  const resolved = results.find((r) => r.toolName === 'resolve_task');
  const value = resolved?.value as { match?: string; reference?: string; task?: { handle?: string } } | undefined;
  if (!value) return null;
  if (value.match === 'ambiguous' && value.reference) return value.reference;
  if (value.match === 'unique') return value.task?.handle ?? firstHandle([resolved!], 'tsk_h_');
  return null;
}

export const COMMAND_SCRIPTS: CommandScript[] = [
  {
    // The 8 AM acceptance command (docs/00 §9, docs/09 §6).
    phrase: /^move the report to tomorrow\.?$/i,
    steps: [
      [{ tool: 'resolve_task', input: { reference: 'the report' } }],
      ({ results }) => {
        const target = resolvedTarget(results);
        return target ? [{ tool: 'propose_update_task', input: { task: target, changes: { due: 'tomorrow' } } }] : 'I could not find a report task.';
      },
      'Moved the report to tomorrow.',
    ],
  },
  {
    // Bulk change: always a confirmation (policy BULK).
    phrase: /^tag all bulk prep tasks with (\w+)\.?$/i,
    steps: [
      ({ match }) => [{ tool: 'propose_bulk_update_tasks', input: { selector: { query: 'Bulk prep', status: 'open' }, change: { addTags: [match[1].toLowerCase()] } } }],
      'Those tasks will be tagged once you confirm.',
    ],
  },
  {
    // Simple create, used by the voice test after the user edits the transcript.
    phrase: /^add a task to (.+?)\.?$/i,
    steps: [({ match }) => [{ tool: 'propose_create_task', input: { title: match[1] } }], 'Added the task.'],
  },
];

export function findCommandScript(input: string): { script: CommandScript; match: RegExpMatchArray } | null {
  const text = input.trim();
  for (const script of COMMAND_SCRIPTS) {
    const match = text.match(script.phrase);
    if (match) return { script, match };
  }
  return null;
}

// ───────────────────────── briefing ─────────────────────────

export interface ScriptBriefingItem {
  kind: 'task';
  title: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  isInferred: boolean;
  sources: { type: 'task'; id: string }[];
  suggestedCommand?: string | null;
}

interface PromptTask {
  id: string;
  title: string;
  bucket: string;
}

/** Task facts from the real briefing prompt (each task is a JSON object inside the tasks block). */
export function tasksInBriefingPrompt(prompt: string): PromptTask[] {
  const out: PromptTask[] = [];
  const re = /\{"type":"task","id":"([^"]+)","title":"((?:[^"\\]|\\.)*)","bucket":"([a-z_]+)"/g;
  for (const m of prompt.matchAll(re)) out.push({ id: m[1], title: JSON.parse(`"${m[2]}"`) as string, bucket: m[3] });
  return out;
}

/**
 * Due-today and overdue tasks become factual items; the first upcoming task
 * becomes an inferred one, so the UI shows both labels. Every item cites a
 * task id that is in the prompt (the real grounding filter still runs).
 */
export function briefingItemsFor(prompt: string): ScriptBriefingItem[] {
  const tasks = tasksInBriefingPrompt(prompt);
  const items: ScriptBriefingItem[] = [];
  for (const t of tasks) {
    if (t.bucket !== 'today' && t.bucket !== 'overdue') continue;
    items.push({
      kind: 'task',
      title: t.title,
      reason: t.bucket === 'today' ? 'Due today' : 'Overdue',
      priority: 'high',
      isInferred: false,
      sources: [{ type: 'task', id: t.id }],
      suggestedCommand: /report/i.test(t.title) ? 'Move the report to tomorrow' : null,
    });
  }
  const upcoming = tasks.find((t) => t.bucket !== 'today' && t.bucket !== 'overdue');
  if (upcoming) {
    items.push({
      kind: 'task',
      title: `Worth starting ${upcoming.title} early`,
      reason: 'Coming up in the next few days',
      priority: 'medium',
      isInferred: true,
      sources: [{ type: 'task', id: upcoming.id }],
    });
  }
  return items.slice(0, 7);
}
