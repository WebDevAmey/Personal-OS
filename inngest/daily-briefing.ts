import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { searchTasks } from '@/lib/tasks/queries';
import { inngest } from './client';
import type { EmailCapability, CalendarCapability } from '@/lib/integrations/types';

export async function generateBriefing(ctx: { userId: string; email: EmailCapability; calendar: CalendarCapability }) {
  const [emails, events, tasks] = await Promise.all([
    ctx.email.search('is:unread'),
    ctx.calendar.search({ from: new Date(), to: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
    searchTasks(ctx.userId, { status: 'open' }),
  ]);

  const result = await generateText({
    model: anthropic('claude-sonnet-5'),
    prompt: `Given these unread emails: ${JSON.stringify(emails)}, today's calendar: ${JSON.stringify(events)}, and open tasks: ${JSON.stringify(tasks)}, respond with strict JSON: { "attentionItems": string[], "digestItems": string[] }. attentionItems is what genuinely needs action today (max 5). digestItems is a short "things to know" summary (max 5).`,
  });

  return JSON.parse(result.text) as { attentionItems: string[]; digestItems: string[] };
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
