import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getTask, isRepoError } from '@/lib/tasks/repo';
import { PageContainer } from '@/components/app/page-header';
import { TaskPage } from '@/components/tasks/task-page';
import { parseId } from '@/app/api/tasks/_lib/http';
import { requirePageUser } from '@/lib/auth/session';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ field?: string }> };

async function load(rawId: string) {
  const id = parseId(rawId);
  if (!id) notFound();
  const { userId } = await requirePageUser();
  try {
    return await getTask(userId, id, { includeDeleted: true });
  } catch (e) {
    if (isRepoError(e)) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const task = await load((await params).id);
  return { title: task.title };
}

export default async function TaskDetailPage({ params, searchParams }: Props) {
  const task = await load((await params).id);
  const { field } = await searchParams;
  return (
    <PageContainer>
      <Link href="/tasks" className="mb-4 inline-flex items-center gap-1.5 rounded-md text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> All tasks
      </Link>
      <h1 className="sr-only">{task.title}</h1>
      <TaskPage taskId={task.id} field={field ?? null} />
    </PageContainer>
  );
}
