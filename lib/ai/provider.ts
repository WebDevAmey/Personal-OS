// lib/ai/provider.ts — the one place a language model is constructed
// (ADR-009). Model id from AI_MODEL, default 'claude-sonnet-5'. Tests inject a
// mock model through the command deps instead of mocking `generateText`.
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

export const DEFAULT_MODEL_ID = 'claude-sonnet-5';

export function modelId(): string {
  const configured = process.env.AI_MODEL?.trim();
  return configured && /^[A-Za-z0-9._:-]{1,100}$/.test(configured) ? configured : DEFAULT_MODEL_ID;
}

export function getLanguageModel(): LanguageModel {
  return anthropic(modelId());
}
