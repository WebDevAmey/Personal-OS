// lib/commands/errors.ts — internal error types of the command pipeline and
// the mapping of provider errors to tool-level / top-level codes (docs/04 §12).
import { NoIntegrationAccountError } from '@/lib/integrations/google/refresh-token';
import {
  IntegrationInputError,
  IntegrationNotFoundError,
  IntegrationScopeError,
  ProviderUnavailableError,
  RateLimitedError,
  TokenRefreshFailedError,
} from '@/lib/integrations/errors';
import type { ErrorCode, ToolErrorCode } from './types';

/** Google is needed but not connected / the grant is unusable. */
export class ReconnectRequiredError extends Error {
  constructor(readonly reason: string) {
    super(`Google reconnect required (${reason})`);
    this.name = 'ReconnectRequiredError';
  }
}

/** A failure with a top-level code (route maps it to the §12 envelope). */
export class CommandError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message ?? code);
    this.name = 'CommandError';
  }
}

export function isReconnect(err: unknown): boolean {
  return (
    err instanceof ReconnectRequiredError ||
    err instanceof NoIntegrationAccountError ||
    err instanceof TokenRefreshFailedError ||
    (err instanceof IntegrationScopeError && err.detail === 'missing')
  );
}

/** Maps anything a provider call threw to a tool error the model can explain. */
export function toolErrorFor(err: unknown): ToolErrorCode {
  if (isReconnect(err)) return 'INTEGRATION_RECONNECT_REQUIRED';
  if (err instanceof RateLimitedError) return 'RATE_LIMITED';
  if (err instanceof ProviderUnavailableError) return err.reason === 'timeout' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE';
  if (err instanceof IntegrationInputError) return 'INVALID_INPUT';
  if (err instanceof IntegrationNotFoundError) return 'NOT_FOUND';
  if (err && typeof err === 'object' && ['AbortError', 'TimeoutError'].includes((err as Error).name)) return 'PROVIDER_TIMEOUT';
  return 'PROVIDER_UNAVAILABLE';
}
