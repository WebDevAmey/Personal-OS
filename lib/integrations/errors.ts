// lib/integrations/errors.ts
//
// Typed provider errors shared by every integration adapter. Rules:
// - Messages describe *what* failed (provider, operation, HTTP status, a
//   short machine reason). They never embed token values, request headers,
//   response bodies, query strings or the original library error, because
//   googleapis/gaxios errors carry the request config (including the
//   `Authorization: Bearer …` header) and Gmail search URLs carry the user's
//   query text.
// - `retryable` tells jobs whether a retry can help; commands degrade.

export type IntegrationProvider = 'google' | 'gmail' | 'calendar' | 'tavily';

export type IntegrationErrorCode =
  | 'INTEGRATION_AUTH_EXPIRED'
  | 'INTEGRATION_SCOPE_MISSING'
  | 'INTEGRATION_INVALID_INPUT'
  | 'INTEGRATION_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE';

export abstract class IntegrationError extends Error {
  abstract readonly code: IntegrationErrorCode;
  abstract readonly retryable: boolean;
  readonly provider: IntegrationProvider;

  protected constructor(provider: IntegrationProvider, message: string) {
    super(message);
    this.provider = provider;
  }
}

/**
 * Base for the reconnect family, kept compatible with the original
 * `TokenRefreshFailedError` contract (`new TokenRefreshFailedError(userId,
 * cause?)`). Existing callers that treat `instanceof TokenRefreshFailedError`
 * as "ask the user to reconnect Google" keep working for the new
 * `NeedsReconnectError` subclass too.
 *
 * `cause`, when present, is a short description (status, error code) and
 * never a token or a raw provider response.
 */
export class TokenRefreshFailedError extends Error {
  constructor(userId: string, cause?: unknown) {
    super(`Failed to refresh Google access token for user ${userId}`);
    this.name = 'TokenRefreshFailedError';
    if (cause !== undefined) this.cause = cause;
  }
}

export type ReconnectReason =
  | 'invalid_grant'
  | 'revoked'
  | 'no_refresh_token'
  | 'unauthorized'
  | 'scope_missing'
  | 'legacy_plaintext';

/**
 * The stored grant can no longer be used: the user must reconnect Google.
 * Thrown for an `invalid_grant` refresh response, a missing refresh token,
 * and a 401 from Gmail/Calendar. The caller decides how to persist the
 * state (an injected `onNeedsReconnect(userId)` callback).
 */
export class NeedsReconnectError extends TokenRefreshFailedError {
  readonly code: IntegrationErrorCode = 'INTEGRATION_AUTH_EXPIRED';
  readonly retryable = false;
  readonly provider: IntegrationProvider;
  readonly reason: ReconnectReason;

  constructor(provider: IntegrationProvider, reason: ReconnectReason, userId?: string) {
    super(userId ?? 'unknown', reason);
    this.name = 'NeedsReconnectError';
    this.provider = provider;
    this.reason = reason;
    this.message = `${provider} access needs to be reconnected (${reason})`;
  }
}

/** The grant lacks a scope we need, or carries a scope we must never hold. */
export class IntegrationScopeError extends IntegrationError {
  readonly code = 'INTEGRATION_SCOPE_MISSING' as const;
  readonly retryable = false;
  readonly detail: 'missing' | 'excessive';

  constructor(provider: IntegrationProvider, detail: 'missing' | 'excessive', scope: string) {
    super(provider, `${provider} grant has ${detail === 'missing' ? 'a missing' : 'an unexpected'} scope: ${scope}`);
    this.name = 'IntegrationScopeError';
    this.detail = detail;
  }
}

export class ProviderUnavailableError extends IntegrationError {
  readonly code = 'UPSTREAM_UNAVAILABLE' as const;
  readonly retryable: boolean;
  readonly status?: number;
  readonly reason: string;

  constructor(provider: IntegrationProvider, opts: { retryable: boolean; status?: number; reason: string; operation?: string }) {
    const where = opts.operation ? ` during ${opts.operation}` : '';
    const status = opts.status !== undefined ? ` (HTTP ${opts.status})` : '';
    super(provider, `${provider} unavailable${where}: ${opts.reason}${status}`);
    this.name = 'ProviderUnavailableError';
    this.retryable = opts.retryable;
    this.status = opts.status;
    this.reason = opts.reason;
  }
}

export class RateLimitedError extends IntegrationError {
  readonly code = 'RATE_LIMITED' as const;
  readonly retryable = true;
  readonly retryAfterMs?: number;

  constructor(provider: IntegrationProvider, retryAfterMs?: number) {
    super(provider, `${provider} rate limit reached`);
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Input rejected before any network call (caps, header injection, bad ids). */
export class IntegrationInputError extends IntegrationError {
  readonly code = 'INTEGRATION_INVALID_INPUT' as const;
  readonly retryable = false;
  readonly field: string;

  constructor(provider: IntegrationProvider, field: string, problem: string) {
    super(provider, `Invalid ${field}: ${problem}`);
    this.name = 'IntegrationInputError';
    this.field = field;
  }
}

export class IntegrationNotFoundError extends IntegrationError {
  readonly code = 'INTEGRATION_NOT_FOUND' as const;
  readonly retryable = false;

  constructor(provider: IntegrationProvider, what: string) {
    super(provider, `${provider} ${what} not found`);
    this.name = 'IntegrationNotFoundError';
  }
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 3_600_000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.min(date - now, 3_600_000));
}

const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ABORT_ERR',
]);

/** True for an AbortSignal.timeout()/abort or a transport-level failure. */
export function isTransportFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown; cause?: unknown };
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  if (typeof e.code === 'string' && NETWORK_CODES.has(e.code)) return true;
  if (e.name === 'TypeError' && e.cause && typeof e.cause === 'object') return isTransportFailure(e.cause);
  return false;
}

export type AnyIntegrationError = IntegrationError | NeedsReconnectError;

/** Narrow to any typed integration error (including the reconnect family). */
export function isIntegrationError(err: unknown): err is AnyIntegrationError {
  return err instanceof IntegrationError || err instanceof NeedsReconnectError;
}
