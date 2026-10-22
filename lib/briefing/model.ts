// lib/briefing/model.ts — language model for briefing generation (ADR-009).
// Same contract as the planned lib/ai/provider.ts: model id from AI_MODEL,
// default 'claude-sonnet-5'. Tests inject a mock model instead of calling this.
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

export const DEFAULT_MODEL_ID = 'claude-sonnet-5';

export function briefingModelId(): string {
  const id = process.env.AI_MODEL?.trim();
  return id && /^[A-Za-z0-9._:-]{1,100}$/.test(id) ? id : DEFAULT_MODEL_ID;
}

export function getBriefingModel(): LanguageModel {
  return anthropic(briefingModelId());
}
