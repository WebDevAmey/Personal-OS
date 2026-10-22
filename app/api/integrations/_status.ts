// app/api/integrations/_status.ts — Google integration status in plain
// language (FR-1001). Shared by GET /api/integrations and the settings page.
import { getIntegration } from '@/lib/account/repo';
import { CALENDAR_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_READONLY_SCOPE, parseScopes } from '@/lib/integrations/google/scopes';
import type { IntegrationDTO } from '@/components/settings/types';

const SCOPE_LABELS: [string, string][] = [
  [GMAIL_READONLY_SCOPE, 'Read email'],
  [GMAIL_COMPOSE_SCOPE, 'Create drafts'],
  [CALENDAR_READONLY_SCOPE, 'Read calendar'],
];

export async function googleIntegrationStatus(userId: string): Promise<IntegrationDTO> {
  const row = await getIntegration(userId, 'google');
  if (!row || row.status === 'DISCONNECTED') {
    return { provider: 'google', state: 'not_connected', accountEmail: null, granted: [], missing: SCOPE_LABELS.map(([, l]) => l), lastUsedAt: null };
  }
  const scopes = parseScopes(row.scopes);
  const granted = SCOPE_LABELS.filter(([s]) => scopes.has(s)).map(([, l]) => l);
  const missing = SCOPE_LABELS.filter(([s]) => !scopes.has(s)).map(([, l]) => l);
  const state = row.status === 'NEEDS_REAUTH' ? 'needs_reconnect' : missing.length ? 'limited' : 'connected';
  return {
    provider: 'google',
    state,
    accountEmail: row.accountEmail,
    granted,
    missing,
    lastUsedAt: (row.lastRefreshedAt ?? row.updatedAt).toISOString(),
  };
}
