import type { Metadata } from 'next';
import { CircleCheck } from 'lucide-react';
import { EmptyState } from '@/components/app/page-header';
import { TaskView, type SearchParams } from '../../_lib/task-view';

export const metadata: Metadata = { title: 'Completed' };

export default function CompletedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <TaskView
      view="completed"
      title="Completed"
      searchParams={searchParams}
      grouped
      filters={{ project: true, group: true }}
      empty={
        <EmptyState icon={CircleCheck} title="Nothing completed yet">
          Finished tasks show up here, grouped by the day you completed them.
        </EmptyState>
      }
    />
  );
}
