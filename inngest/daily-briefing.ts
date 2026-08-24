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

export const dailyBriefingFn = inngest.createFunction(
  { id: 'daily-briefing', retries: 3, triggers: { cron: '0 8 * * *' } },
  async ({ step }) => {
    // V1: iterate integration_accounts directly; a per-user fan-out event is a
    // straightforward Phase 2 change once user volume justifies it.
    const { db } = await import('@/db/client');
    const { integrationAccounts, dailyBriefings } = await import('@/db/schema');
    const { createGmailCapability } = await import('@/lib/integrations/gmail/client');
    const { createCalendarCapability } = await import('@/lib/integrations/calendar/client');

    const accounts = await step.run('load-accounts', () => db.select().from(integrationAccounts));

    for (const account of accounts) {
      await step.run(`briefing-${account.userId}`, async () => {
        const briefing = await generateBriefing({
          userId: account.userId,
          email: createGmailCapability(account.accessToken),
          calendar: createCalendarCapability(account.accessToken),
        });
        await db.insert(dailyBriefings).values({
          userId: account.userId,
          briefingDate: new Date().toISOString().slice(0, 10),
          attentionItems: briefing.attentionItems,
          digestItems: briefing.digestItems,
        });
      });
    }
  },
);
