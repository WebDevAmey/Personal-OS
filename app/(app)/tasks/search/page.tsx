import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import { EmptyState } from '@/components/app/page-header';
import { TaskView, type SearchParams } from '../../_lib/task-view';

export const metadata: Metadata = { title: 'Search' };

export default function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <TaskView
      view="all"
      title="Search"
      description="Words match titles, notes and tags. Narrow with status:done, project:work, tag:home, due:today or priority:high."
      searchParams={searchParams}
      filters={{ search: true, sort: true }}
      requireQuery={
        <EmptyState icon={Search} title="Search your tasks">
          Start typing above. Results update as you type.
        </EmptyState>
      }
      empty={
        <EmptyState icon={Search} title="No matching tasks">
          Try fewer words, or ask in the command palette (⌘K) — it also searches email and memory.
        </EmptyState>
      }
    />
  );
}
