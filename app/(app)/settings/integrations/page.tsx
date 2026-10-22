import type { Metadata } from 'next';
import { IntegrationsPanel } from '@/components/settings/integrations-panel';
import { googleIntegrationStatus } from '@/app/api/integrations/_status';
import { requirePageUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  const { userId } = await requirePageUser();
  return <IntegrationsPanel google={await googleIntegrationStatus(userId)} />;
}
