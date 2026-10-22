import type { Metadata } from 'next';
import { listProjects } from '@/lib/projects/repo';
import { PageContainer, PageHeader } from '@/components/app/page-header';
import { ProjectsManager } from '@/components/tasks/projects-manager';
import { toProjectDTO } from '@/app/api/tasks/_lib/serialize';
import { pageUser } from '../_lib/data';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const { userId } = await pageUser();
  const all = (await listProjects(userId, { includeArchived: true })).map(toProjectDTO);
  return (
    <PageContainer>
      <PageHeader title="Projects" description="Group related tasks. Type #project when you add a task to file it." />
      <ProjectsManager projects={all.filter((p) => !p.archivedAt)} archived={all.filter((p) => p.archivedAt)} />
    </PageContainer>
  );
}
