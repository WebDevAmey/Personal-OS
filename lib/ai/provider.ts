// lib/ai/provider.ts — the one place a language model is constructed
// (ADR-009). Model id from AI_MODEL, default 'claude-sonnet-5'. Tests inject a
// mock model through the command deps instead of mocking `generateText`.
// E2E runs get the deterministic scripted model, behind the double gate in
// lib/env.ts scriptedModelAllowed() (never on a production deployment).
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { scriptedModelAllowed } from '@/lib/env';
import { SCRIPTED_MODEL_ID, createScriptedModel } from './scripted-model';

export const DEFAULT_MODEL_ID = 'claude-sonnet-5';

export function modelId(): string {
  if (scriptedModelAllowed()) return SCRIPTED_MODEL_ID;
  const configured = process.env.AI_MODEL?.trim();
  return configured && /^[A-Za-z0-9._:-]{1,100}$/.test(configured) ? configured : DEFAULT_MODEL_ID;
}

export function getLanguageModel(): LanguageModel {
  if (scriptedModelAllowed()) return createScriptedModel();
  return anthropic(modelId());
}
