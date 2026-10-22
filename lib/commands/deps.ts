// lib/commands/deps.ts — the command pipeline's external seams: clock,
// language model, Google (lazy, per run), web search, embeddings, rate limit.
// Route handlers call getCommandDeps(); tests substitute fakes.
import type { LanguageModel } from 'ai';
import { embed } from '@/lib/ai/embeddings';
import { getLanguageModel } from '@/lib/ai/provider';
import { createCalendarCapability } from '@/lib/integrations/calendar/client';
import { createGmailCapability } from '@/lib/integrations/gmail/client';
import { getFreshAccessToken } from '@/lib/integrations/google/refresh-token';
import type { CalendarClient, GmailClient, WebCapability } from '@/lib/integrations/types';
import { createWebCapability } from '@/lib/integrations/web/client';
import type { EmbedFn } from '@/lib/memory/repo';
import { checkRateLimit, type RateLimitBucket, type RateLimitResult } from '@/lib/rate-limit';
import { ReconnectRequiredError, isReconnect } from './errors';
import { findDraftByMessageId } from './gmail-drafts';
import { googleConnection, markGoogleNeedsReauth } from './repo';

export type GmailLike = Pick<GmailClient, 'search' | 'get' | 'createDraft'> & {
  findDraftByMessageId?: (messageIdHeader: string) => Promise<{ draftId: string } | null>;
};
export type CalendarLike = Pick<CalendarClient, 'listEvents'>;

/** Lazily-connected Google access for one user; tokens are fetched on first use only. */
export interface GoogleAccess {
  gmail(): Promise<GmailLike>;
  calendar(): Promise<CalendarLike>;
}

export interface CommandDeps {
  now(): Date;
  model(): LanguageModel;
  google(userId: string): GoogleAccess;
  web(): WebCapability | null;
  embed: EmbedFn;
  rateLimit(userId: string, bucket: RateLimitBucket): Promise<RateLimitResult>;
}

function defaultGoogle(userId: string): GoogleAccess {
  let token: Promise<string> | null = null;
  const onNeedsReconnect = (id: string) => markGoogleNeedsReauth(id);
  const getToken = () => {
    token ??= (async () => {
      if ((await googleConnection(userId)) === 'none') throw new ReconnectRequiredError('not_connected');
      try {
        return await getFreshAccessToken(userId, { onNeedsReconnect });
      } catch (e) {
        if (isReconnect(e)) throw new ReconnectRequiredError('token');
        throw e;
      }
    })();
    // A failed fetch is not memoised, so a later tool call can retry.
    token.catch(() => {
      token = null;
    });
    return token;
  };
  return {
    async gmail() {
      const accessToken = await getToken();
      const client = createGmailCapability(accessToken, { userId, onNeedsReconnect });
      return { ...client, findDraftByMessageId: (id: string) => findDraftByMessageId(accessToken, id, { userId, onNeedsReconnect }) };
    },
    async calendar() {
      return createCalendarCapability(await getToken(), { userId, onNeedsReconnect });
    },
  };
}

export function getCommandDeps(): CommandDeps {
  return {
    now: () => new Date(),
    model: getLanguageModel,
    google: defaultGoogle,
    web: () => (process.env.TAVILY_API_KEY ? createWebCapability(process.env.TAVILY_API_KEY) : null),
    embed,
    rateLimit: checkRateLimit,
  };
}
