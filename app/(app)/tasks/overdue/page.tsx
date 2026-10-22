import type { Metadata } from 'next';
import { CircleCheck } from 'lucide-react';
import { EmptyState } from '@/components/app/page-header';
import { TaskView, type SearchParams } from '../../_lib/task-view';

export const metadata: Metadata = { title: 'Overdue' };

export default function OverduePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <TaskView
      view="overdue"
      title="Overdue"
      searchParams={searchParams}
      filters={{ sort: true, priority: true, project: true }}
      empty={
        <EmptyState icon={CircleCheck} title="Nothing overdue">
          You&rsquo;re caught up. Select several tasks with X to reschedule them together when this fills up.
        </EmptyState>
      }
    />
  );
}
