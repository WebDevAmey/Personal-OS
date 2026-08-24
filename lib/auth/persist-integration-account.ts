import { db } from '@/db/client';
import { integrationAccounts } from '@/db/schema';

export async function persistIntegrationAccount(userId: string, account: {
  accessToken: string;
  refreshToken?: string | null;
  scopes: string;
  expiresAt?: Date | null;
}) {
  await db.insert(integrationAccounts).values({
    userId,
    provider: 'google',
    accessToken: account.accessToken,
    refreshToken: account.refreshToken ?? null,
    scopes: account.scopes,
    expiresAt: account.expiresAt ?? null,
  }).onConflictDoUpdate({
    target: [integrationAccounts.userId, integrationAccounts.provider],
    set: {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken ?? null,
      scopes: account.scopes,
      expiresAt: account.expiresAt ?? null,
    },
  });
}
