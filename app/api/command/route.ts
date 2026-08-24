import { auth } from '@/auth';
import { db } from '@/db/client';
import { integrationAccounts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { runCommand } from '@/lib/ai/orchestrator';
import { createGmailCapability } from '@/lib/integrations/gmail/client';
import { createCalendarCapability } from '@/lib/integrations/calendar/client';
import { createWebCapability } from '@/lib/integrations/web/client';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { input } = await req.json();
  const [account] = await db.select().from(integrationAccounts).where(eq(integrationAccounts.userId, session.user.id));

  const result = await runCommand({
    userId: session.user.id,
    email: createGmailCapability(account.accessToken),
    calendar: createCalendarCapability(account.accessToken),
    web: createWebCapability(process.env.TAVILY_API_KEY!),
  }, input);

  return Response.json(result);
}
