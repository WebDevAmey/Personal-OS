import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/auth/session';
import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/app/page-header';
import { TaskView, type SearchParams } from '../_lib/task-view';

export const metadata: Metadata = { title: 'Upcoming' };

export default async function UpcomingPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId } = await requirePageUser();
  return (
    <TaskView
      userId={userId}
      view="upcoming"
      title="Upcoming"
      searchParams={searchParams}
      grouped
      filters={{ priority: true, project: true, group: true }}
      empty={
        <EmptyState icon={CalendarDays} title="Nothing scheduled ahead">
          Tasks due after today appear here by day for the next two weeks, then under Later.
        </EmptyState>
      }
    />
  );
}
