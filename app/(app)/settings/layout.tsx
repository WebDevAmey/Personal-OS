import { requirePageUser } from '@/lib/auth/session';
import { PageContainer, PageHeader } from '@/components/app/page-header';
import { SettingsNav } from '@/components/settings/settings-nav';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Settings">
        <SettingsNav />
      </PageHeader>
      {children}
    </PageContainer>
  );
}
