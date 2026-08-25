// lib/integrations/google/refresh-token.ts
//
// Ported from the Drizzle-era version (same file path, same public shape) to
// read/write the new Prisma-managed `IntegrationAccount` table instead of
// Drizzle's `integration_accounts`. Consumers (app/api/command/route.ts,
// inngest/daily-briefing.ts) import only `getFreshAccessToken`,
// `NoIntegrationAccountError`, and `TokenRefreshFailedError` — their public
// shape (constructor arity included) is preserved unchanged here so those
// call sites, and their existing tests, keep working without modification.
import { prisma } from '@/lib/prisma';

/** How long before actual expiry we treat a token as needing a refresh. */
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Thrown when the given user has no `google` row in `IntegrationAccount` at
 * all. Distinct from `TokenRefreshFailedError` so callers can show a
 * "connect your Google account" message instead of a generic error - the
 * user has literally never (or no longer) has a linked Google account.
 */
export class NoIntegrationAccountError extends Error {
  constructor(userId: string) {
    super(`No google IntegrationAccount row for user ${userId}`);
    this.name = 'NoIntegrationAccountError';
  }
}

/**
 * Thrown when we have an integration account but couldn't turn it into a
 * fresh access token - either Google's refresh endpoint rejected the
 * refresh token (revoked/expired), or there's no refresh token stored to
 * use in the first place. Callers should surface a "reconnect your Google
 * account" message, same as `NoIntegrationAccountError`.
 *
 * `cause`, when present, is a human-readable description of *what* failed
 * (an HTTP status, a response shape) - never the live token values
 * themselves. See the `expires_in`/`access_token` validation below for why
 * that distinction matters.
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
 * of expiring. Persists any refreshed token back to `IntegrationAccount` so
 * future calls (and other readers of that table) see the update.
 */
export async function getFreshAccessToken(userId: string): Promise<string> {
  const account = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: 'google' } },
  });

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
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
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
  // a missing `expires_in` or `access_token` silently produces an Invalid
  // Date / a null access token below, which Prisma's DateTime encoder or the
  // `accessToken` NOT NULL constraint throws a raw (untyped) error on
  // later - escaping the route's `instanceof TokenRefreshFailedError` guard
  // and producing exactly the raw 500 this error-handling chain exists to
  // prevent. Fail loudly and typed here instead.
  //
  // IMPORTANT: `data` is a *successful* token response - it carries a live
  // access_token and possibly a rotated refresh_token. Never interpolate
  // `data` (or any of its values) into an error message/log line; only
  // describe its shape (types, key names) so this stays safe to log.
  if (
    typeof data.expires_in !== 'number' ||
    !Number.isFinite(data.expires_in) ||
    typeof data.access_token !== 'string'
  ) {
    throw new TokenRefreshFailedError(
      userId,
      `Google token endpoint response missing a valid expires_in/access_token (expires_in: ${typeof data.expires_in}, access_token: ${typeof data.access_token}; keys: ${Object.keys(data).join(',')})`,
    );
  }

  // Google does not always return a new refresh_token on a refresh call -
  // only keep the new one if it sent one, otherwise the existing refresh
  // token is still valid and must be preserved.
  const refreshToken = data.refresh_token ?? account.refreshToken;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  // The check above only validates that `expires_in` is a finite number -
  // it doesn't validate the *result* of using it. Number.isFinite(1e300) is
  // true, but new Date(Date.now() + 1e300 * 1000) is an Invalid Date, which
  // Prisma's DateTime encoder turns into an untyped error when persisting -
  // the same escape-the-instanceof-guard problem as above.
  if (Number.isNaN(expiresAt.getTime())) {
    throw new TokenRefreshFailedError(
      userId,
      `Google token endpoint returned an out-of-range expires_in (expires_in type: ${typeof data.expires_in})`,
    );
  }

  await prisma.integrationAccount.update({
    where: { userId_provider: { userId, provider: 'google' } },
    data: {
      accessToken: data.access_token,
      refreshToken,
      expiresAt,
    },
  });

  return data.access_token;
}
