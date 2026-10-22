import { PageContainer, PageHeader } from '@/components/app/page-header';
import { SettingsNav } from '@/components/settings/settings-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <PageHeader title="Settings">
        <SettingsNav />
      </PageHeader>
      {children}
    </PageContainer>
  );
}
