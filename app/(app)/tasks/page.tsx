import type { Metadata } from 'next';
import { ListChecks } from 'lucide-react';
import { EmptyState } from '@/components/app/page-header';
import { NewTaskButton } from '@/components/app/new-task-button';
import { TaskView, type SearchParams } from '../_lib/task-view';

export const metadata: Metadata = { title: 'All tasks' };

export default function AllTasksPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <TaskView
      view="all"
      title="All tasks"
      searchParams={searchParams}
      openByDefault
      filters={{ sort: true, status: true, priority: true, project: true }}
      empty={
        <EmptyState icon={ListChecks} title="No tasks match" action={<NewTaskButton variant="primary" label="Add a task" />}>
          Press <kbd className="font-mono">C</kbd> to add one, or clear the filters above.
        </EmptyState>
      }
    />
  );
}
