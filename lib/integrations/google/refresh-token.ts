// lib/integrations/google/refresh-token.ts
//
// Returns a usable Google access token for a user, refreshing it when it is
// missing an expiry, expired, or within five minutes of expiring.
//
// Tokens at rest (ADR-011): rows are read through `decryptToken` with the
// row's context (userId:provider:column), and every write seals as v2. A row
// still holding plaintext (written before encryption landed, and missed by
// scripts/encrypt-integration-tokens.ts) is never used: the user is asked to
// reconnect (docs/03 §7.4). Revocation is the one exception, so the grant can
// still be revoked at Google.
//
// Errors are typed and never contain token values:
// - NoIntegrationAccountError: no google row for the user.
// - NeedsReconnectError (a TokenRefreshFailedError): the grant is unusable —
//   `invalid_grant` (revoked/expired refresh token) or no refresh token.
//   The caller's optional `onNeedsReconnect(userId)` runs first, so it can
//   persist the state (WS-1 owns the schema field).
// - ProviderUnavailableError: token endpoint 5xx, timeout or network error
//   (retryable).
// - RateLimitedError: token endpoint 429.
// - TokenRefreshFailedError: anything else (malformed response, client
//   misconfiguration, undecryptable stored token).
import { prisma } from '@/lib/prisma';
import { decryptToken, encryptToken, isEncryptedToken, tokenContext, type TokenColumn } from '@/lib/security/token-crypto';
import { logger as defaultLogger, type Logger } from '@/lib/observability/logger';
import {
  NeedsReconnectError,
  ProviderUnavailableError,
  RateLimitedError,
  TokenRefreshFailedError,
  isTransportFailure,
  parseRetryAfter,
} from '../errors';

export { NeedsReconnectError, TokenRefreshFailedError } from '../errors';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** How long before actual expiry we treat a token as needing a refresh. */
export const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;
export const TOKEN_ENDPOINT_TIMEOUT_MS = 10_000;

/**
 * Thrown when the given user has no `google` row in `IntegrationAccount` at
 * all, so callers can show "connect your Google account".
 */
export class NoIntegrationAccountError extends Error {
  constructor(userId: string) {
    super(`No google IntegrationAccount row for user ${userId}`);
    this.name = 'NoIntegrationAccountError';
  }
}

export interface TokenOptions {
  /** Invoked before NeedsReconnectError is thrown. Its own errors are logged and swallowed. */
  onNeedsReconnect?: (userId: string) => void | Promise<void>;
  logger?: Logger;
  timeoutMs?: number;
}

function needsRefresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - REFRESH_SAFETY_MARGIN_MS <= Date.now();
}

/** Decrypts a stored Google token for `userId`. Throws on plaintext or a value sealed for another row. */
export function readStoredToken(value: string, userId: string, column: TokenColumn): string {
  return decryptToken(value, tokenContext(userId, 'google', column));
}

function sealToken(value: string, userId: string, column: TokenColumn): string {
  return encryptToken(value, tokenContext(userId, 'google', column));
}

interface GoogleTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
}

/** Extracts Google's OAuth `error` code from a response body, if it is a safe identifier. */
function oauthErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string' && /^[a-z_]{1,64}$/.test(parsed.error)) return parsed.error;
  } catch {
    // Not JSON; fall through to a keyword check.
  }
  const match = /\b(invalid_grant|invalid_token|invalid_client|unauthorized_client|invalid_request|invalid_scope)\b/.exec(body);
  return match?.[1];
}

async function signalReconnect(userId: string, opts: TokenOptions, log: Logger): Promise<void> {
  if (!opts.onNeedsReconnect) return;
  try {
    await opts.onNeedsReconnect(userId);
  } catch (err) {
    log.error('integration.google.on_needs_reconnect_failed', { userId, errorName: (err as Error)?.name });
  }
}

/**
 * Returns a Google access token for `userId` that is safe to use right now,
 * refreshing (and persisting, encrypted) first when needed.
 */
export async function getFreshAccessToken(userId: string, opts: TokenOptions = {}): Promise<string> {
  const log = opts.logger ?? defaultLogger;
  const account = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: 'google' } },
  });

  if (!account) {
    throw new NoIntegrationAccountError(userId);
  }

  if (!isEncryptedToken(account.accessToken) || (account.refreshToken && !isEncryptedToken(account.refreshToken))) {
    log.warn('integration.google.needs_reconnect', { userId, reason: 'legacy_plaintext' });
    await signalReconnect(userId, opts, log);
    throw new NeedsReconnectError('google', 'legacy_plaintext', userId);
  }

  let storedRefresh: string | null;
  try {
    if (!needsRefresh(account.expiresAt)) {
      return readStoredToken(account.accessToken, userId, 'accessToken');
    }
    storedRefresh = account.refreshToken ? readStoredToken(account.refreshToken, userId, 'refreshToken') : null;
  } catch (err) {
    // Wrong/rotated TOKEN_ENCRYPTION_KEY or a tampered row. This is an
    // operator problem, so do not flag the user for reconnect.
    log.error('integration.google.token_decrypt_failed', { userId, errorName: (err as Error)?.name });
    throw new TokenRefreshFailedError(userId, 'stored token could not be decrypted');
  }

  if (!storedRefresh) {
    log.warn('integration.google.needs_reconnect', { userId, reason: 'no_refresh_token' });
    await signalReconnect(userId, opts, log);
    throw new NeedsReconnectError('google', 'no_refresh_token', userId);
  }

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        refresh_token: storedRefresh,
        grant_type: 'refresh_token',
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? TOKEN_ENDPOINT_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = isTransportFailure(err) && ['AbortError', 'TimeoutError'].includes((err as Error).name) ? 'timeout' : 'network';
    log.warn('integration.google.token_refresh_failed', { userId, reason });
    throw new ProviderUnavailableError('google', { retryable: true, reason, operation: 'token refresh' });
  }

  if (!response.ok) {
    const status = response.status;
    const body = await response.text().catch(() => '');
    const errorCode = oauthErrorCode(body);
    log.warn('integration.google.token_refresh_failed', { userId, status, errorCode });

    if (errorCode === 'invalid_grant') {
      await signalReconnect(userId, opts, log);
      throw new NeedsReconnectError('google', 'invalid_grant', userId);
    }
    if (status === 429) {
      throw new RateLimitedError('google', parseRetryAfter(response.headers?.get?.('retry-after')));
    }
    if (status >= 500) {
      throw new ProviderUnavailableError('google', { retryable: true, status, reason: 'server_error', operation: 'token refresh' });
    }
    throw new TokenRefreshFailedError(userId, `Google token endpoint returned ${status}${errorCode ? ` (${errorCode})` : ''}`);
  }

  let data: GoogleTokenResponse;
  try {
    data = (await response.json()) as GoogleTokenResponse;
  } catch {
    throw new TokenRefreshFailedError(userId, 'Google token endpoint returned a non-JSON body');
  }

  // `data` is a successful token response carrying live secrets: only ever
  // describe its shape (types, key names), never its values.
  if (
    typeof data !== 'object' || data === null ||
    typeof data.expires_in !== 'number' ||
    !Number.isFinite(data.expires_in) ||
    typeof data.access_token !== 'string' ||
    data.access_token.length === 0
  ) {
    throw new TokenRefreshFailedError(
      userId,
      `Google token endpoint response missing a valid expires_in/access_token (expires_in: ${typeof data?.expires_in}, access_token: ${typeof data?.access_token}; keys: ${Object.keys(data ?? {}).join(',')})`,
    );
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new TokenRefreshFailedError(
      userId,
      `Google token endpoint returned an out-of-range expires_in (expires_in type: ${typeof data.expires_in})`,
    );
  }

  // Google does not always rotate the refresh token: keep the existing one
  // unless a new one was returned. Both are written sealed as v2, which also
  // moves v1 rows to the row-bound format.
  const newRefresh = typeof data.refresh_token === 'string' && data.refresh_token.length > 0 ? data.refresh_token : storedRefresh;

  await prisma.integrationAccount.update({
    where: { userId_provider: { userId, provider: 'google' } },
    data: {
      accessToken: sealToken(data.access_token, userId, 'accessToken'),
      refreshToken: sealToken(newRefresh, userId, 'refreshToken'),
      expiresAt,
    },
  });
  log.info('integration.google.token_refreshed', { userId, rotated: newRefresh !== storedRefresh });

  return data.access_token;
}

export interface RevokeResult {
  /** True when Google confirmed revocation or reported the token already invalid. */
  revoked: boolean;
  alreadyInvalid: boolean;
}

/**
 * Revokes a Google token (refresh tokens revoke the whole grant). Used on
 * disconnect. A 400 `invalid_token` means it was already revoked/expired and
 * counts as success.
 */
export async function revokeGoogleToken(token: string, opts: Pick<TokenOptions, 'logger' | 'timeoutMs'> = {}): Promise<RevokeResult> {
  const log = opts.logger ?? defaultLogger;
  let response: Response;
  try {
    response = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? TOKEN_ENDPOINT_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = ['AbortError', 'TimeoutError'].includes((err as Error)?.name) ? 'timeout' : 'network';
    log.warn('integration.google.revoke_failed', { reason });
    throw new ProviderUnavailableError('google', { retryable: true, reason, operation: 'token revoke' });
  }
  if (response.ok) return { revoked: true, alreadyInvalid: false };

  const body = await response.text().catch(() => '');
  const errorCode = oauthErrorCode(body);
  log.warn('integration.google.revoke_failed', { status: response.status, errorCode });
  if (response.status === 400 && errorCode === 'invalid_token') {
    return { revoked: true, alreadyInvalid: true };
  }
  if (response.status === 429) throw new RateLimitedError('google', parseRetryAfter(response.headers?.get?.('retry-after')));
  throw new ProviderUnavailableError('google', {
    retryable: response.status >= 500,
    status: response.status,
    reason: response.status >= 500 ? 'server_error' : 'revoke_rejected',
    operation: 'token revoke',
  });
}

/**
 * Revokes the stored Google grant for `userId` (refresh token preferred,
 * access token as fallback). Does not delete the row: the disconnect flow
 * deletes or marks it after this resolves.
 */
export async function revokeGoogleAccess(userId: string, opts: Pick<TokenOptions, 'logger' | 'timeoutMs'> = {}): Promise<RevokeResult> {
  const log = opts.logger ?? defaultLogger;
  const account = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: 'google' } },
  });
  if (!account) throw new NoIntegrationAccountError(userId);

  let token: string;
  try {
    const column: TokenColumn = account.refreshToken ? 'refreshToken' : 'accessToken';
    const stored = account.refreshToken ?? account.accessToken;
    token = isEncryptedToken(stored) ? readStoredToken(stored, userId, column) : stored;
  } catch (err) {
    log.error('integration.google.token_decrypt_failed', { userId, errorName: (err as Error)?.name });
    throw new TokenRefreshFailedError(userId, 'stored token could not be decrypted');
  }
  const result = await revokeGoogleToken(token, opts);
  log.info('integration.google.revoked', { userId, alreadyInvalid: result.alreadyInvalid });
  return result;
}
