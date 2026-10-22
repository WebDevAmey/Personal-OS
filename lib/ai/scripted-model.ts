// lib/ai/scripted-model.ts — deterministic language model for E2E runs only.
//
// Reachable only through getLanguageModel() when scriptedModelAllowed()
// (lib/env.ts) is true: E2E_SCRIPTED_MODEL=1 plus the explicit
// E2E_ALLOW_SCRIPTED_MODEL acknowledgement, and never on a production
// deployment (the server also refuses to boot there with the flag set).
//
// It speaks the AI SDK model protocol, so the real generateText /
// generateObject loops, tool schemas and tool execution run unchanged. What it
// says comes from e2e/fixtures/model-script.ts.
import type { LanguageModel } from 'ai';
import {
  UNKNOWN_COMMAND_REPLY,
  briefingItemsFor,
  findCommandScript,
  type ScriptToolResult,
} from '@/e2e/fixtures/model-script';

type ModelV4 = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type CallOptions = Parameters<ModelV4['doGenerate']>[0];
type GenerateResult = Awaited<ReturnType<ModelV4['doGenerate']>>;

export const SCRIPTED_MODEL_ID = 'e2e-scripted';

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p: { type?: string; text?: string }) => (p.type === 'text' ? (p.text ?? '') : '')).join('');
}

function userText(call: CallOptions): string {
  return call.prompt.filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('\n');
}

function lastToolResults(call: CallOptions): ScriptToolResult[] {
  let last: ScriptToolResult[] = [];
  for (const msg of call.prompt) {
    if (msg.role !== 'tool') continue;
    const batch: ScriptToolResult[] = [];
    for (const part of msg.content) {
      if (part.type !== 'tool-result') continue;
      const value = (part.output as { value?: unknown }).value;
      batch.push({ toolName: part.toolName, value, text: typeof value === 'string' ? value : JSON.stringify(value) });
    }
    last = batch;
  }
  return last;
}

let callSeq = 0;

function text(t: string): GenerateResult {
  return { content: t ? [{ type: 'text', text: t }] : [], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
}

function generate(call: CallOptions): GenerateResult {
  // Briefing: generateObject asks for JSON.
  if (call.responseFormat?.type === 'json') return text(JSON.stringify({ items: briefingItemsFor(userText(call)) }));

  const input = userText(call).split('User command:\n').pop()?.trim() ?? '';
  const found = findCommandScript(input);
  if (!found) return text(UNKNOWN_COMMAND_REPLY);
  const stepIndex = call.prompt.filter((m) => m.role === 'assistant').length;
  const step = found.script.steps[stepIndex];
  const resolved = typeof step === 'function' ? step({ input, match: found.match, results: lastToolResults(call) }) : (step ?? '');
  if (typeof resolved === 'string') return text(resolved);
  return {
    content: resolved.map((c) => ({ type: 'tool-call' as const, toolCallId: `call_e2e_${++callSeq}`, toolName: c.tool, input: JSON.stringify(c.input) })),
    finishReason: { unified: 'tool-calls', raw: undefined },
    usage,
    warnings: [],
  };
}

export function createScriptedModel(): LanguageModel {
  const model: ModelV4 = {
    specificationVersion: 'v4',
    provider: 'e2e',
    modelId: SCRIPTED_MODEL_ID,
    supportedUrls: {},
    doGenerate: async (call) => generate(call),
    doStream: async () => {
      throw new Error('The E2E scripted model does not stream');
    },
  };
  return model;
}
