import type { Metadata } from 'next';
import { IntegrationsPanel } from '@/components/settings/integrations-panel';
import { googleIntegrationStatus } from '@/app/api/integrations/_status';
import { pageUser } from '../../_lib/data';

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  const { userId } = await pageUser();
  return <IntegrationsPanel google={await googleIntegrationStatus(userId)} />;
}
