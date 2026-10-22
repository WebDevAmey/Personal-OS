import type { Metadata } from 'next';
import { PreferencesForm } from '@/components/settings/preferences-form';
import { requirePageUser } from '@/lib/auth/session';
import { userContext } from '../_lib/data';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { userId } = await requirePageUser();
  const { preferences } = await userContext(userId);
  return <PreferencesForm key={preferences.version} initial={preferences} />;
}
