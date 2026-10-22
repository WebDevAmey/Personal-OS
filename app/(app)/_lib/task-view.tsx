// app/(app)/_lib/task-view.tsx — one server renderer for every task list
// view (all, inbox, overdue, completed, upcoming, search, project). The URL
// carries sort / filter / group so views are linkable.
import { PageContainer, PageHeader } from '@/components/app/page-header';
import { TaskFilters, type TaskFiltersProps } from '@/components/tasks/task-filters';
import { TaskList } from '@/components/tasks/task-list';
import { ViewQuerySchema } from '@/app/api/tasks/_lib/schemas';
import { listView, type ViewQuery } from '@/app/api/tasks/_lib/service';
import { userContext } from './data';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const OPEN = 'INBOX,TODO,IN_PROGRESS';
const PAGE_LIMIT = 200;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Keeps the valid parts of the URL query; a bad value is dropped, not fatal. */
export function viewQueryFrom(raw: Record<string, string | string[] | undefined>, base: Partial<ViewQuery>): ViewQuery {
  const picked: Record<string, string> = {};
  for (const key of ['sort', 'status', 'priority', 'tag', 'q', 'projectId'] as const) {
    const v = first(raw[key]);
    if (v === undefined || v === '') continue;
    const one = ViewQuerySchema.safeParse({ [key]: v });
    if (one.success) picked[key] = v;
  }
  return ViewQuerySchema.parse({ ...picked, ...base, limit: PAGE_LIMIT });
}

export interface TaskViewProps {
  /** The authenticated user (the page calls requirePageUser). */
  userId: string;
  view: ViewQuery['view'];
  title: string;
  description?: React.ReactNode;
  searchParams: SearchParams;
  filters: TaskFiltersProps['show'];
  /** Show group headings by default (user can turn off with ?group=none). */
  grouped?: boolean;
  /** Open tasks only unless the user picks a status (All tasks). */
  openByDefault?: boolean;
  empty: React.ReactNode;
  projectId?: string;
  actions?: React.ReactNode;
  /** Search view: render nothing until there is a query. */
  requireQuery?: React.ReactNode;
}

export async function TaskView({ userId, view, title, description, searchParams, filters, grouped, openByDefault, empty, projectId, actions, requireQuery }: TaskViewProps) {
  const { clock } = await userContext(userId);
  const raw = await searchParams;
  const q = viewQueryFrom(raw, { view, ...(projectId ? { projectId } : {}) });
  if (openByDefault && !q.status && !q.q) q.status = OPEN;
  const needsQuery = requireQuery && !q.q;
  const page = needsQuery ? null : await listView(userId, q, clock);
  const groupOn = grouped && first(raw.group) !== 'none';
  const count = page?.items.length ?? 0;

  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={
          description ??
          (page ? (
            <span className="tabular">
              {count === PAGE_LIMIT && page.nextCursor ? `First ${PAGE_LIMIT} tasks — narrow the filters to see the rest` : `${count} task${count === 1 ? '' : 's'}`}
            </span>
          ) : null)
        }
        actions={actions}
      >
        <TaskFilters show={filters} />
      </PageHeader>
      {page ? <TaskList items={page.items} today={page.today} label={title} grouped={groupOn} empty={empty} /> : requireQuery}
    </PageContainer>
  );
}
