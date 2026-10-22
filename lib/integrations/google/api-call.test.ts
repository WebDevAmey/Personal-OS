// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/lib/observability/logger';
import {
  IntegrationNotFoundError,
  IntegrationScopeError,
  NeedsReconnectError,
  ProviderUnavailableError,
  RateLimitedError,
} from '../errors';
import { callGoogle, mapGoogleApiError } from './api-call';

const TOKEN = 'ya29.a0-secret-access-token-value';

/** Shaped like a gaxios error: carries the request config with the bearer token. */
function gaxiosError(status: number, extra: Record<string, unknown> = {}) {
  const err = new Error(`Request failed with status code ${status}; Authorization: Bearer ${TOKEN}`) as Error & Record<string, unknown>;
  err.status = status;
  err.config = { headers: { Authorization: `Bearer ${TOKEN}` }, url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=secret+query' };
  err.response = { status, headers: {}, data: { error: { message: `bad token ${TOKEN}` } }, ...(extra.response as object) };
  Object.assign(err, extra);
  return err;
}

describe('mapGoogleApiError', () => {
  it('401 -> NeedsReconnectError', () => {
    expect(mapGoogleApiError('gmail', gaxiosError(401), 'messages.list')).toBeInstanceOf(NeedsReconnectError);
  });

  it.each([500, 502, 503])('%i -> retryable ProviderUnavailableError', (status) => {
    const mapped = mapGoogleApiError('gmail', gaxiosError(status), 'messages.list');
    expect(mapped).toBeInstanceOf(ProviderUnavailableError);
    expect(mapped.retryable).toBe(true);
  });

  it('429 and 403 rateLimitExceeded -> RateLimitedError', () => {
    expect(mapGoogleApiError('gmail', gaxiosError(429, { response: { status: 429, headers: { 'retry-after': '3' } } }), 'x')).toBeInstanceOf(RateLimitedError);
    expect(mapGoogleApiError('gmail', gaxiosError(403, { errors: [{ reason: 'userRateLimitExceeded' }] }), 'x')).toBeInstanceOf(RateLimitedError);
  });

  it('403 insufficientPermissions -> IntegrationScopeError', () => {
    expect(mapGoogleApiError('calendar', gaxiosError(403, { errors: [{ reason: 'insufficientPermissions' }] }), 'x')).toBeInstanceOf(IntegrationScopeError);
  });

  it('404 -> IntegrationNotFoundError', () => {
    expect(mapGoogleApiError('gmail', gaxiosError(404), 'x')).toBeInstanceOf(IntegrationNotFoundError);
  });

  it('timeouts and network errors -> retryable ProviderUnavailableError', () => {
    const timeout = mapGoogleApiError('gmail', new DOMException('timed out', 'TimeoutError'), 'x');
    expect(timeout).toBeInstanceOf(ProviderUnavailableError);
    expect(timeout.retryable).toBe(true);
    const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    expect(mapGoogleApiError('gmail', reset, 'x').retryable).toBe(true);
  });

  it('never copies the original message, config or response into the typed error', () => {
    for (const status of [400, 401, 403, 404, 429, 500]) {
      const mapped = mapGoogleApiError('gmail', gaxiosError(status), 'messages.list');
      const text = [mapped.message, String(mapped.cause ?? ''), JSON.stringify(mapped), mapped.stack ?? ''].join('\n');
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain('secret+query');
    }
  });
});

describe('callGoogle', () => {
  it('passes an AbortSignal and timeout to the request', async () => {
    const request = vi.fn(async (o: { signal: AbortSignal; timeout: number }) => o);
    const opts = await callGoogle({ provider: 'gmail', timeoutMs: 1234 }, 'op', request);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.timeout).toBe(1234);
  });

  it('calls onNeedsReconnect with the user id on 401 and logs no token', async () => {
    const lines: string[] = [];
    const onNeedsReconnect = vi.fn();
    const err = await callGoogle(
      { provider: 'gmail', userId: 'user-1', onNeedsReconnect, logger: createLogger({}, (l) => lines.push(l)) },
      'messages.list',
      async () => { throw gaxiosError(401); },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NeedsReconnectError);
    expect(onNeedsReconnect).toHaveBeenCalledWith('user-1');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('does not call onNeedsReconnect for a 5xx', async () => {
    const onNeedsReconnect = vi.fn();
    await expect(callGoogle({ provider: 'calendar', userId: 'u', onNeedsReconnect, logger: createLogger({}, () => {}) }, 'events.list', async () => {
      throw gaxiosError(503);
    })).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(onNeedsReconnect).not.toHaveBeenCalled();
  });
});
