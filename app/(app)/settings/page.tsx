import type { Metadata } from 'next';
import { PreferencesForm } from '@/components/settings/preferences-form';
import { pageUser } from '../_lib/data';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { preferences } = await pageUser();
  return <PreferencesForm key={preferences.version} initial={preferences} />;
}
