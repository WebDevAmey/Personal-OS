import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { searchTasks } from '@/lib/tasks/queries';
import { inngest } from './client';
import type { EmailCapability, CalendarCapability } from '@/lib/integrations/types';

const briefingSchema = z.object({
  attentionItems: z.array(z.string()),
  digestItems: z.array(z.string()),
});

export async function generateBriefing(ctx: { userId: string; email: EmailCapability; calendar: CalendarCapability }) {
  const [emails, events, tasks] = await Promise.all([
    ctx.email.search('is:unread'),
    ctx.calendar.search({ from: new Date(), to: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
    searchTasks(ctx.userId, { status: 'open' }),
  ]);

  // generateObject (schema-validated) instead of generateText + JSON.parse:
  // raw-text JSON parsing was fragile against markdown code fences, leading
  // prose, or truncation, and a parse failure inside step.run would trigger
  // Inngest's retry logic (burning duplicate Claude API calls) before
  // ultimately failing silently.
  const result = await generateObject({
    model: anthropic('claude-sonnet-5'),
    schema: briefingSchema,
    prompt: `Given these unread emails: ${JSON.stringify(emails)}, today's calendar: ${JSON.stringify(events)}, and open tasks: ${JSON.stringify(tasks)}, generate attentionItems (what genuinely needs action today, max 5) and digestItems (a short "things to know" summary, max 5).`,
  });

  return result.object;
}

/**
 * Loads the distinct set of userIds with a linked integration account.
 * Deliberately returns bare userIds, never whole `integration_accounts`
 * rows: this is the return value of the `load-accounts` Inngest step below,
 * and Inngest persists a step's return value in its own durable/cloud state
 * (and shows it in the run inspector UI) - access_token/refresh_token must
 * never end up there.
 */
export async function loadAccountUserIds(): Promise<string[]> {
  const { db } = await import('@/db/client');
  const { integrationAccounts } = await import('@/db/schema');
  const rows = await db.select({ userId: integrationAccounts.userId }).from(integrationAccounts);
  return [...new Set(rows.map((row) => row.userId))];
}

/**
 * Generates and persists one user's daily briefing. Fetches its own fresh
 * Google access token internally (via getFreshAccessToken) rather than
 * accepting one as a parameter, so no token ever needs to flow through -
 * and get memoized by - the outer Inngest step's return value.
 */
export async function generateAndSaveBriefing(userId: string): Promise<void> {
  const { db } = await import('@/db/client');
  const { dailyBriefings } = await import('@/db/schema');
  const { createGmailCapability } = await import('@/lib/integrations/gmail/client');
  const { createCalendarCapability } = await import('@/lib/integrations/calendar/client');
  const { getFreshAccessToken } = await import('@/lib/integrations/google/refresh-token');

  const accessToken = await getFreshAccessToken(userId);
  const briefing = await generateBriefing({
    userId,
    email: createGmailCapability(accessToken),
    calendar: createCalendarCapability(accessToken),
  });
  await db.insert(dailyBriefings).values({
    userId,
    briefingDate: new Date().toISOString().slice(0, 10),
    attentionItems: briefing.attentionItems,
    digestItems: briefing.digestItems,
  });
}

export const dailyBriefingFn = inngest.createFunction(
  { id: 'daily-briefing', retries: 3, triggers: { cron: '0 8 * * *' } },
  async ({ step }) => {
    // V1: iterate integration_accounts directly; a per-user fan-out event is a
    // straightforward Phase 2 change once user volume justifies it.
    const userIds = await step.run('load-accounts', loadAccountUserIds);

    // One user's failure (e.g. a revoked refresh token) must not take down
    // everyone else's briefing: without this try/catch, a thrown step.run
    // retries 3x and then fails the whole function, so every user later in
    // the loop gets no briefing that day - not just the one with the bad
    // token. Log and move on to the next user instead.
    for (const userId of userIds) {
      try {
        await step.run(`briefing-${userId}`, () => generateAndSaveBriefing(userId));
      } catch (err) {
        console.error(`[daily-briefing] failed to generate briefing for user ${userId}:`, err);
      }
    }
  },
);
