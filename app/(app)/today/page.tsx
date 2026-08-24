import { auth } from '@/auth';
import { db } from '@/db/client';
import { dailyBriefings } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { BriefingView } from '@/components/briefing/briefing-view';

export default async function TodayPage() {
  const session = await auth();
  const [briefing] = await db.select().from(dailyBriefings)
    .where(eq(dailyBriefings.userId, session!.user!.id!))
    .orderBy(desc(dailyBriefings.generatedAt))
    .limit(1);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Today</h1>
      <BriefingView briefing={briefing ?? null} />
    </main>
  );
}
