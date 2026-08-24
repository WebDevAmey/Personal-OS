import { auth } from '@/auth';
import { runCommand } from '@/lib/ai/orchestrator';
import { createGmailCapability } from '@/lib/integrations/gmail/client';
import { createCalendarCapability } from '@/lib/integrations/calendar/client';
import { createWebCapability } from '@/lib/integrations/web/client';
import {
  getFreshAccessToken,
  NoIntegrationAccountError,
  TokenRefreshFailedError,
} from '@/lib/integrations/google/refresh-token';

const RECONNECT_MESSAGE = 'Your Google account connection has expired or is missing — please sign in again to reconnect.';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { input } = await req.json();

  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(session.user.id);
  } catch (err) {
    // Missing account row or a failed refresh (e.g. revoked refresh token)
    // both mean the same thing to the user: reconnect Google. Respond 200
    // with a friendly message (matching the rate-limit-exceeded pattern in
    // lib/ai/orchestrator.ts) instead of a 500 - the command bar UI just
    // renders `message` either way. Still log server-side (including
    // TokenRefreshFailedError's `cause`, which carries Google's HTTP status
    // and response body) so a genuine Google outage, a misconfigured
    // AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET, and an actually-revoked user grant
    // stay distinguishable in the logs even though the user sees the same
    // friendly message either way.
    if (err instanceof NoIntegrationAccountError || err instanceof TokenRefreshFailedError) {
      if (err instanceof TokenRefreshFailedError && err.cause !== undefined) {
        console.error(`[command] getFreshAccessToken failed for user ${session.user.id}:`, err, 'cause:', err.cause);
      } else {
        console.error(`[command] getFreshAccessToken failed for user ${session.user.id}:`, err);
      }
      return Response.json({ message: RECONNECT_MESSAGE });
    }
    throw err;
  }

  const result = await runCommand({
    userId: session.user.id,
    email: createGmailCapability(accessToken),
    calendar: createCalendarCapability(accessToken),
    web: createWebCapability(process.env.TAVILY_API_KEY!),
  }, input);

  return Response.json(result);
}
