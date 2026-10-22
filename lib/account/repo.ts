// lib/account/repo.ts — ownership-scoped reads for the settings pages
// (ADR-006): the signed-in user's profile, passkeys and Google integration
// status, plus removing the integration row after its grant was revoked.
// Token columns are never selected here.
import { prisma } from '@/lib/prisma';
import { reader, type Tx } from '@/lib/db/tx';

export interface AccountProfile {
  email: string;
  name: string | null;
  hasPassword: boolean;
}

export async function getAccountProfile(userId: string, opts: { tx?: Tx } = {}): Promise<AccountProfile | null> {
  const user = await reader(opts.tx).user.findUnique({ where: { id: userId }, select: { email: true, name: true, password: true } });
  return user ? { email: user.email, name: user.name, hasPassword: user.password !== null } : null;
}

export interface PasskeySummary {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listPasskeys(userId: string, opts: { tx?: Tx } = {}): Promise<PasskeySummary[]> {
  return reader(opts.tx).passkeyCredential.findMany({
    where: { userId },
    select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

export interface IntegrationSummary {
  provider: string;
  status: 'ACTIVE' | 'NEEDS_REAUTH' | 'DISCONNECTED';
  accountEmail: string | null;
  scopes: string;
  lastRefreshedAt: Date | null;
  updatedAt: Date;
}

export async function getIntegration(userId: string, provider: string, opts: { tx?: Tx } = {}): Promise<IntegrationSummary | null> {
  return reader(opts.tx).integrationAccount.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { provider: true, status: true, accountEmail: true, scopes: true, lastRefreshedAt: true, updatedAt: true },
  });
}

/** Deletes the user's integration row (after the grant was revoked at the provider). Returns whether one existed. */
export async function deleteIntegration(userId: string, provider: string): Promise<boolean> {
  const res = await prisma.integrationAccount.deleteMany({ where: { userId, provider } });
  return res.count > 0;
}
