import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Folder } from 'lucide-react';
import { getProject } from '@/lib/projects/repo';
import { isRepoError } from '@/lib/db/errors';
import { EmptyState } from '@/components/app/page-header';
import { NewTaskButton } from '@/components/app/new-task-button';
import { parseId } from '@/app/api/tasks/_lib/http';
import { pageUser } from '../../_lib/data';
import { TaskView, type SearchParams } from '../../_lib/task-view';

type Props = { params: Promise<{ id: string }>; searchParams: SearchParams };

async function load(rawId: string) {
  const id = parseId(rawId);
  if (!id) notFound();
  const { userId } = await pageUser();
  try {
    const p = await getProject(userId, id);
    if (p.deletedAt) notFound();
    return p;
  } catch (e) {
    if (isRepoError(e)) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id)).name };
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const project = await load((await params).id);
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--content-max)] px-4 pt-6 sm:px-6">
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-4" /> Projects
        </Link>
      </div>
      <TaskView
        view="project"
        projectId={project.id}
        title={project.name}
        description={project.description ?? undefined}
        searchParams={searchParams}
        grouped
        filters={{ sort: true, priority: true, group: true }}
        actions={<NewTaskButton />}
        empty={
          <EmptyState icon={Folder} title="No tasks in this project">
            Add one with C and type #{project.name.includes(' ') ? `"${project.name}"` : project.name}.
          </EmptyState>
        }
      />
    </>
  );
}
