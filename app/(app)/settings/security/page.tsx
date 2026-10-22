import type { Metadata } from 'next';
import { getAccountProfile, listPasskeys } from '@/lib/account/repo';
import { SecurityPanel } from '@/components/settings/security-panel';
import { requirePageUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Security' };

export default async function SecurityPage() {
  const { userId } = await requirePageUser();
  const [passkeys, profile] = await Promise.all([listPasskeys(userId), getAccountProfile(userId)]);
  return (
    <SecurityPanel
      email={profile?.email ?? ''}
      passkeys={passkeys.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() ?? null }))}
    />
  );
}
