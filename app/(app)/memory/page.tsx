import type { Metadata } from 'next';
import { listMemories } from '@/lib/memory/repo';
import { PageContainer, PageHeader } from '@/components/app/page-header';
import { MemoryManager } from '@/components/settings/memory-manager';
import { toMemoryDTO } from '@/app/api/tasks/_lib/settings';
import { pageUser } from '../_lib/data';

export const metadata: Metadata = { title: 'Memory' };

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { userId } = await pageUser();
  const raw = (await searchParams).q;
  const q = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
  const [live, deleted] = await Promise.all([
    listMemories(userId, { text: q || undefined, limit: 100 }),
    q ? Promise.resolve({ items: [] }) : listMemories(userId, { deleted: true, limit: 20 }),
  ]);
  return (
    <PageContainer>
      <PageHeader title="Memory" description="Facts Personal OS keeps about you. Edit or delete anything; deleted items can be restored for 30 days." />
      <MemoryManager items={live.items.map(toMemoryDTO)} deleted={deleted.items.map(toMemoryDTO)} query={q} />
    </PageContainer>
  );
}
