// lib/integrations/google/api-call.ts
//
// One place that runs a googleapis request with a per-call timeout and turns
// whatever it throws into a typed integration error. The original error is
// deliberately dropped (not attached as `cause`): gaxios errors carry the
// request config, including the `Authorization: Bearer …` header, and Gmail
// list URLs include the user's search text.
import { logger as defaultLogger, type Logger } from '@/lib/observability/logger';
import {
  IntegrationError,
  IntegrationNotFoundError,
  IntegrationScopeError,
  NeedsReconnectError,
  ProviderUnavailableError,
  RateLimitedError,
  isTransportFailure,
  parseRetryAfter,
  type IntegrationProvider,
} from '../errors';

/** Google API timeout (docs/02 §Timeouts). */
export const GOOGLE_TIMEOUT_MS = 10_000;

export interface GoogleCallContext {
  provider: Extract<IntegrationProvider, 'gmail' | 'calendar'>;
  timeoutMs?: number;
  /** Used only to invoke `onNeedsReconnect`; never logged with token data. */
  userId?: string;
  /** Called once when Google answers 401 for this grant. Errors in it are logged and swallowed. */
  onNeedsReconnect?: (userId: string) => void | Promise<void>;
  logger?: Logger;
}

interface GoogleErrorShape {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  response?: { status?: unknown; headers?: unknown; data?: unknown };
  errors?: unknown;
}

function statusOf(err: GoogleErrorShape): number | undefined {
  const candidates = [err.status, err.response?.status, err.code];
  for (const c of candidates) {
    if (typeof c === 'number' && c >= 100 && c < 600) return c;
    if (typeof c === 'string' && /^[1-5]\d\d$/.test(c)) return Number(c);
  }
  return undefined;
}

function headerOf(err: GoogleErrorShape, name: string): string | undefined {
  const headers = err.response?.headers;
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const value = (headers as Record<string, unknown>)[name] ?? (headers as Record<string, unknown>)[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

/** Google's machine-readable reasons, e.g. `rateLimitExceeded`, `insufficientPermissions`. */
function reasonsOf(err: GoogleErrorShape): string[] {
  const out: string[] = [];
  const collect = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const reason = (item as { reason?: unknown })?.reason;
      if (typeof reason === 'string') out.push(reason);
    }
  };
  collect(err.errors);
  const data = err.response?.data as { error?: { errors?: unknown; status?: unknown; details?: unknown } } | undefined;
  collect(data?.error?.errors);
  if (typeof data?.error?.status === 'string') out.push(data.error.status);
  collect(data?.error?.details);
  return out;
}

const SAFE_REASON = /^[A-Za-z_]{1,64}$/;

/** Maps anything thrown by a googleapis call to a typed error. Pure; no side effects. */
export function mapGoogleApiError(provider: GoogleCallContext['provider'], err: unknown, operation: string): IntegrationError | NeedsReconnectError {
  if (err instanceof IntegrationError || err instanceof NeedsReconnectError) return err;
  if (isTransportFailure(err)) {
    const name = (err as { name?: unknown }).name;
    const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
    return new ProviderUnavailableError(provider, { retryable: true, reason, operation });
  }
  const shape = (err ?? {}) as GoogleErrorShape;
  const status = statusOf(shape);
  const reasons = reasonsOf(shape);

  if (status === 401) return new NeedsReconnectError(provider, 'unauthorized');
  if (status === 429 || reasons.some((r) => /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/.test(r))) {
    return new RateLimitedError(provider, parseRetryAfter(headerOf(shape, 'retry-after')));
  }
  if (status === 403) {
    if (reasons.some((r) => /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/.test(r))) {
      return new IntegrationScopeError(provider, 'missing', 'required scope');
    }
    return new ProviderUnavailableError(provider, { retryable: false, status, reason: 'forbidden', operation });
  }
  if (status === 404 || status === 410) return new IntegrationNotFoundError(provider, 'resource');
  if (status !== undefined && status >= 500) {
    return new ProviderUnavailableError(provider, { retryable: true, status, reason: 'server_error', operation });
  }
  if (status !== undefined) {
    const reason = reasons.find((r) => SAFE_REASON.test(r)) ?? 'request_rejected';
    return new ProviderUnavailableError(provider, { retryable: false, status, reason, operation });
  }
  return new ProviderUnavailableError(provider, { retryable: false, reason: 'unexpected_error', operation });
}

/**
 * Runs `request(signal)` with `AbortSignal.timeout`, maps failures, logs a
 * redacted event, and fires `onNeedsReconnect` on a 401.
 */
export async function callGoogle<T>(
  ctx: GoogleCallContext,
  operation: string,
  request: (opts: { signal: AbortSignal; timeout: number }) => Promise<T>,
): Promise<T> {
  const timeout = ctx.timeoutMs ?? GOOGLE_TIMEOUT_MS;
  const log = ctx.logger ?? defaultLogger;
  try {
    return await request({ signal: AbortSignal.timeout(timeout), timeout });
  } catch (err) {
    const mapped = mapGoogleApiError(ctx.provider, err, operation);
    log.warn('integration.google.call_failed', {
      provider: ctx.provider,
      operation,
      errorName: mapped.name,
      status: mapped instanceof ProviderUnavailableError ? mapped.status : undefined,
      retryable: mapped.retryable,
    });
    if (mapped instanceof NeedsReconnectError && ctx.userId && ctx.onNeedsReconnect) {
      try {
        await ctx.onNeedsReconnect(ctx.userId);
      } catch (cbErr) {
        log.error('integration.google.on_needs_reconnect_failed', { provider: ctx.provider, errorName: (cbErr as Error)?.name });
      }
    }
    throw mapped;
  }
}
