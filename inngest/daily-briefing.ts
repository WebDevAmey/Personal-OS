// inngest/daily-briefing.ts — Inngest functions for the morning briefing
// (ADR-010). Thin adapters: all logic lives in lib/briefing/service.ts.
//
//  briefing-scheduler  cron every 15 min → PENDING run + one event per due user
//  briefing-generate   per user: concurrency 1 per userId, idempotency per
//                      dedupeKey (`userId-localDate`, or `…-rN` for a retry),
//                      3 retries with Inngest's exponential backoff; onFailure
//                      marks the run FAILED. The DB unique (userId, localDate)
//                      and the claim are the real duplicate guard.
import { createCalendarCapability } from '@/lib/integrations/calendar/client';
import { createGmailCapability } from '@/lib/integrations/gmail/client';
import { getFreshAccessToken } from '@/lib/integrations/google/refresh-token';
import { embed } from '@/lib/ai/embeddings';
import { logger } from '@/lib/observability/logger';
import { modelId as briefingModelId, getLanguageModel as getBriefingModel } from '@/lib/ai/provider';
import {
  GENERATE_RETRIES,
  handleBriefingFailure,
  runBriefingGenerate,
  runSchedulerTick,
  type JobDeps,
  type StepLike,
} from '@/lib/briefing/service';
import { BRIEFING_EVENT } from '@/lib/briefing/types';
import type { BriefingEventPayload } from '@/lib/briefing/events';
import { inngest } from './client';

export function defaultJobDeps(): JobDeps {
  return {
    now: () => new Date(),
    model: getBriefingModel,
    modelId: briefingModelId(),
    logger: logger.child({ job: 'briefing' }),
    embed: process.env.VOYAGE_API_KEY ? embed : null,
    google: {
      getAccessToken: (userId, opts) => getFreshAccessToken(userId, opts),
      gmail: (token, opts) => createGmailCapability(token, opts),
      calendar: (token, opts) => createCalendarCapability(token, opts),
    },
  };
}

interface InngestStep {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
  sendEvent: (id: string, events: BriefingEventPayload[]) => Promise<unknown>;
}

/** Inngest's step tools, narrowed to the StepLike seam (step outputs are JSON-safe by construction). */
export function adaptStep(step: unknown): StepLike {
  const s = step as InngestStep;
  return {
    run: <T>(id: string, fn: () => Promise<T>) => s.run(id, fn) as Promise<T>,
    sendEvent: (id, events) => s.sendEvent(id, events),
  };
}

export const briefingSchedulerFn = inngest.createFunction(
  {
    id: 'briefing-scheduler',
    name: 'Briefing scheduler',
    retries: 1,
    concurrency: { limit: 1 },
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }) => runSchedulerTick(adaptStep(step), defaultJobDeps()),
);

export const briefingGenerateFn = inngest.createFunction(
  {
    id: 'briefing-generate',
    name: 'Briefing generate (per user)',
    retries: GENERATE_RETRIES,
    concurrency: { key: 'event.data.userId', limit: 1 },
    idempotency: 'event.data.dedupeKey',
    triggers: [{ event: BRIEFING_EVENT }],
    onFailure: async ({ event, error }) => {
      const original = (event as { data?: { event?: { data?: unknown } } }).data?.event?.data;
      await handleBriefingFailure(original, error, defaultJobDeps());
    },
  },
  async ({ event, step, runId, attempt, maxAttempts }) =>
    runBriefingGenerate(
      { eventData: event.data, runId, attempt, maxAttempts: maxAttempts ?? GENERATE_RETRIES + 1 },
      adaptStep(step),
      defaultJobDeps(),
    ),
);

export const briefingFunctions = [briefingSchedulerFn, briefingGenerateFn];
