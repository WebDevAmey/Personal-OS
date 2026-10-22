import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/auth/session';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/app/page-header';
import { TaskView, type SearchParams } from '../../_lib/task-view';

export const metadata: Metadata = { title: 'Inbox' };

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId } = await requirePageUser();
  return (
    <TaskView
      userId={userId}
      view="inbox"
      title="Inbox"
      searchParams={searchParams}
      filters={{ sort: true, priority: true }}
      empty={
        <EmptyState icon={Inbox} title="Inbox zero">
          Tasks you capture without a date or project land here until you sort them.
        </EmptyState>
      }
    />
  );
}
