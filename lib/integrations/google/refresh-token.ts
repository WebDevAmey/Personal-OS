import { db } from '@/db/client';
import { integrationAccounts } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { persistIntegrationAccount } from '@/lib/auth/persist-integration-account';

/** How long before actual expiry we treat a token as needing a refresh. */
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Thrown when the given user has no `google` row in `integration_accounts`
 * at all. Distinct from `TokenRefreshFailedError` so callers can show a
 * "connect your Google account" message instead of a generic error - the
 * user has literally never (or no longer) has a linked Google account.
 */
export class NoIntegrationAccountError extends Error {
  constructor(userId: string) {
    super(`No google integration_accounts row for user ${userId}`);
    this.name = 'NoIntegrationAccountError';
  }
}

/**
 * Thrown when we have an integration account but couldn't turn it into a
 * fresh access token - either Google's refresh endpoint rejected the
 * refresh token (revoked/expired), or there's no refresh token stored to
 * use in the first place. Callers should surface a "reconnect your Google
 * account" message, same as `NoIntegrationAccountError`.
 */
export class TokenRefreshFailedError extends Error {
  constructor(userId: string, cause?: unknown) {
    super(`Failed to refresh Google access token for user ${userId}`);
    this.name = 'TokenRefreshFailedError';
    if (cause !== undefined) this.cause = cause;
  }
}

function needsRefresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - REFRESH_SAFETY_MARGIN_MS <= Date.now();
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

/**
 * Returns a Google access token for `userId` that is safe to use right now,
 * refreshing it via Google's token endpoint first if the stored token is
 * missing an expiry, already expired, or within `REFRESH_SAFETY_MARGIN_MS`
 * of expiring. Reuses `persistIntegrationAccount` to write any refreshed
 * token back so future calls (and other readers of `integration_accounts`)
 * see the update.
 */
export async function getFreshAccessToken(userId: string): Promise<string> {
  const [account] = await db.select().from(integrationAccounts)
    .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.provider, 'google')));

  if (!account) {
    throw new NoIntegrationAccountError(userId);
  }

  if (!needsRefresh(account.expiresAt)) {
    return account.accessToken;
  }

  if (!account.refreshToken) {
    throw new TokenRefreshFailedError(userId);
  }

  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID!,
        client_secret: process.env.AUTH_GOOGLE_SECRET!,
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
  } catch (err) {
    throw new TokenRefreshFailedError(userId, err);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new TokenRefreshFailedError(userId, `Google token endpoint returned ${response.status}: ${body}`);
  }

  const data = await response.json() as GoogleTokenResponse;

  // Guard against a malformed/incomplete response from Google: without this,
  // a missing `expires_in` silently produces an Invalid Date below, which
  // drizzle's timestamp encoder throws a raw (untyped) RangeError on later -
  // escaping the route's `instanceof TokenRefreshFailedError` guard and
  // producing exactly the raw 500 this error-handling chain exists to
  // prevent. Fail loudly and typed here instead.
  if (typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)) {
    throw new TokenRefreshFailedError(userId, `Google token endpoint response missing a valid expires_in: ${JSON.stringify(data)}`);
  }

  // Google does not always return a new refresh_token on a refresh call -
  // only keep the new one if it sent one, otherwise the existing refresh
  // token is still valid and must be preserved.
  const refreshToken = data.refresh_token ?? account.refreshToken;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await persistIntegrationAccount(userId, {
    accessToken: data.access_token,
    refreshToken,
    scopes: account.scopes,
    expiresAt,
  });

  return data.access_token;
}
