// DELETE /api/integrations/google — Disconnect Google (FR-1002, AC-1001):
// revoke the grant at Google, then delete the IntegrationAccount row.
// If Google already considers the token invalid, revocation counts as done.
// If Google cannot be reached the row is kept and the user is told to retry,
// so we never forget a grant that is still live at Google.
import { revokeGoogleAccess, NoIntegrationAccountError } from '@/lib/integrations/google/refresh-token';
import { TokenRefreshFailedError } from '@/lib/integrations/errors';
import { deleteIntegration } from '@/lib/account/repo';
import { logger } from '@/lib/observability/logger';
import { apiError, json, route } from '@/app/api/tasks/_lib/http';
import { googleIntegrationStatus } from '../_status';

export async function DELETE(req: Request) {
  return route(req, { bodiless: true }, async ({ userId }) => {
    try {
      await revokeGoogleAccess(userId);
    } catch (e) {
      if (e instanceof NoIntegrationAccountError) {
        return json({ integration: await googleIntegrationStatus(userId) });
      }
      // An undecryptable stored token cannot be revoked by us; the grant is
      // unusable to this app either way, so dropping the row is the safe end state.
      if (!(e instanceof TokenRefreshFailedError)) {
        logger.warn('integration.google.disconnect_revoke_failed', { userId, errorName: (e as Error)?.name });
        return apiError(503, 'PROVIDER_UNAVAILABLE', "Google isn't responding right now — try disconnecting again in a minute.");
      }
    }
    await deleteIntegration(userId, 'google');
    logger.info('integration.google.disconnected', { userId });
    return json({ integration: await googleIntegrationStatus(userId) });
  });
}
