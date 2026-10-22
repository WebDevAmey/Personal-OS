import type { Metadata } from 'next';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/app/page-header';
import { NewTaskButton } from '@/components/app/new-task-button';
import { TaskView, type SearchParams } from '../../_lib/task-view';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <TaskView
      view="inbox"
      title="Inbox"
      searchParams={searchParams}
      filters={{ sort: true, priority: true }}
      actions={<NewTaskButton />}
      empty={
        <EmptyState icon={Inbox} title="Inbox zero">
          Tasks you capture without a date or project land here until you sort them.
        </EmptyState>
      }
    />
  );
}
