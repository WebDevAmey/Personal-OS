// app/(app)/today/page.tsx — Today: the morning briefing, then today's tasks,
// with the schedule rail on wide screens (docs/07 §8). Loading Today without
// a briefing enqueues one (ADR-010); the panel then polls while it prepares.
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CalendarDays } from 'lucide-react';
import { ensureTodayBriefingQueued, getTodayBriefing } from '@/lib/briefing/today';
import type { TodayBriefing } from '@/lib/briefing/types';
import { getTask } from '@/lib/tasks/repo';
import { zonedParts } from '@/lib/time';
import { logger } from '@/lib/observability/logger';
import { EmptyState, PageContainer, PageHeader } from '@/components/app/page-header';
import { NewTaskButton } from '@/components/app/new-task-button';
import { BriefingPanel, type TaskStateMap } from '@/components/briefing/briefing-panel';
import { Agenda, AgendaSkeleton } from '@/components/briefing/agenda';
import { TaskList } from '@/components/tasks/task-list';
import { googleIntegrationStatus } from '@/app/api/integrations/_status';
import { listView } from '@/app/api/tasks/_lib/service';
import { toTaskDTO } from '@/app/api/tasks/_lib/serialize';
import { pageUser } from '../_lib/data';

export const metadata: Metadata = { title: 'Today' };

function greeting(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

async function loadBriefing(userId: string): Promise<TodayBriefing> {
  try {
    let result = await getTodayBriefing(userId);
    if (result.status === 'none' || result.status === 'failed') {
      const queued = await ensureTodayBriefingQueued(userId);
      if (queued === 'queued' || queued === 'running') result = { ...result, status: 'preparing' };
    }
    return result;
  } catch (e) {
    logger.error('today.briefing_read_failed', { errorName: (e as Error)?.name });
    return { status: 'failed' };
  }
}

export default async function TodayPage() {
  const { userId, clock } = await pageUser();
  const [briefing, tasks, google] = await Promise.all([
    loadBriefing(userId),
    listView(userId, { view: 'today', limit: 200 }, clock),
    googleIntegrationStatus(userId),
  ]);

  // Live reconciliation: the current state of every task the briefing cites.
  const cited = [...new Set((briefing.briefing?.items ?? []).flatMap((i) => i.sources.filter((s) => s.type === 'task').map((s) => s.id)))];
  const taskStates: TaskStateMap = {};
  await Promise.all(
    cited.map(async (id) => {
      try {
        const t = toTaskDTO(await getTask(userId, id, { includeDeleted: true }), clock);
        taskStates[id] = { status: t.status, due: t.due, deleted: Boolean(t.deletedAt) };
      } catch {
        taskStates[id] = { status: 'CANCELLED', due: null, deleted: true };
      }
    }),
  );

  const parts = zonedParts(clock.now, clock.timeZone);
  const dateLabel = clock.now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: clock.timeZone });
  const open = tasks.items.length;

  return (
    <PageContainer wide>
      <PageHeader title={greeting(parts.hour)} description={dateLabel} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_var(--rail-w)]">
        <div className="flex min-w-0 flex-col gap-6">
          <BriefingPanel result={briefing} today={clock.today} google={google.state} taskStates={taskStates} />
          <section aria-labelledby="today-tasks">
            <div className="mb-2 flex items-baseline justify-between px-2">
              <h2 id="today-tasks" className="text-heading-sm text-foreground">
                Today&rsquo;s tasks <span className="tabular font-normal text-subtle-foreground">· {open}</span>
              </h2>
              <Link href="/upcoming" className="text-meta text-muted-foreground hover:text-foreground">
                See Upcoming
              </Link>
            </div>
            <TaskList
              items={tasks.items}
              today={tasks.today}
              label="Today’s tasks"
              grouped
              hideGroups={tasks.items.every((i) => i.group === 'today') ? ['today'] : []}
              empty={
                <EmptyState icon={CalendarDays} title="No tasks due today." action={<NewTaskButton label="Add a task" />}>
                  <Link href="/upcoming" className="text-brand hover:underline">
                    See Upcoming
                  </Link>
                </EmptyState>
              }
            />
          </section>
        </div>
        <aside aria-label="Schedule" className="min-w-0">
          <Suspense fallback={<AgendaSkeleton />}>
            <Agenda userId={userId} timeZone={clock.timeZone} today={clock.today} google={google.state} />
          </Suspense>
        </aside>
      </div>
    </PageContainer>
  );
}
