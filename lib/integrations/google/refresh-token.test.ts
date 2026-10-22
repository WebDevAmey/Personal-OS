// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '@/lib/observability/logger';
import { decryptToken, encryptToken, isEncryptedToken } from '@/lib/security/token-crypto';
import { ProviderUnavailableError, RateLimitedError } from '../errors';
import {
  NeedsReconnectError,
  NoIntegrationAccountError,
  TokenRefreshFailedError,
  getFreshAccessToken,
  revokeGoogleAccess,
  revokeGoogleToken,
} from './refresh-token';

process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');

vi.mock('@/lib/prisma', () => ({
  prisma: { integrationAccount: { findUnique: vi.fn(), update: vi.fn() } },
}));

type Mocked = { integrationAccount: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } };

const ACCESS = 'ya29.access-token-value-that-must-never-leak';
const REFRESH = '1//refresh-token-value-that-must-never-leak';
const NEW_ACCESS = 'ya29.new-access-token-value-that-must-never-leak';

const originalFetch = global.fetch;
let db: Mocked;
let logLines: string[];
let logger: ReturnType<typeof createLogger>;

function row(overrides: Record<string, unknown> = {}) {
  return { accessToken: encryptToken(ACCESS), refreshToken: encryptToken(REFRESH), expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly', ...overrides };
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() };
}

function errorResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return { ok: false, status, text: async () => body, json: async () => JSON.parse(body), headers: new Headers(headers) };
}

function mockFetch(impl: (...args: unknown[]) => unknown) {
  const fn = vi.fn(impl);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

async function caught(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected rejection');
}

function assertNoSecrets(err: Error) {
  const text = [err.message, String(err.cause ?? ''), JSON.stringify(err), err.stack ?? '', ...logLines].join('\n');
  for (const secret of [ACCESS, REFRESH, NEW_ACCESS]) expect(text).not.toContain(secret);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = (await import('@/lib/prisma')).prisma as unknown as Mocked;
  logLines = [];
  logger = createLogger({}, (line) => logLines.push(line));
});
afterEach(() => { global.fetch = originalFetch; });

describe('getFreshAccessToken', () => {
  it('returns the decrypted token without a network call when still fresh', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) }));
    const fetchMock = mockFetch(() => { throw new Error('no network'); });
    await expect(getFreshAccessToken('user-1')).resolves.toBe(ACCESS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a legacy plaintext row transparently', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row({ accessToken: 'still-fresh-plain', expiresAt: new Date(Date.now() + 60 * 60 * 1000) }));
    await expect(getFreshAccessToken('user-1')).resolves.toBe('still-fresh-plain');
  });

  it('refreshes inside the 5-minute safety margin', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() + 4 * 60 * 1000) }));
    mockFetch(async () => okJson({ access_token: NEW_ACCESS, expires_in: 3600 }));
    await expect(getFreshAccessToken('user-1')).resolves.toBe(NEW_ACCESS);
  });

  it('refreshes, sends the decrypted refresh token, and persists both tokens encrypted', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    const fetchMock = mockFetch(async () => okJson({ access_token: NEW_ACCESS, expires_in: 3600 }));

    await expect(getFreshAccessToken('user-1', { logger })).resolves.toBe(NEW_ACCESS);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect((init.body as URLSearchParams).get('refresh_token')).toBe(REFRESH);
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const { data } = db.integrationAccount.update.mock.calls[0][0];
    expect(isEncryptedToken(data.accessToken)).toBe(true);
    expect(isEncryptedToken(data.refreshToken)).toBe(true);
    expect(decryptToken(data.accessToken)).toBe(NEW_ACCESS);
    expect(decryptToken(data.refreshToken)).toBe(REFRESH);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3500 * 1000);
    expect(logLines.join('\n')).not.toContain(NEW_ACCESS);
    expect(logLines.join('\n')).not.toContain(REFRESH);
  });

  it('re-encrypts a legacy plaintext row on the next write', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row({ accessToken: 'stale-plain', refreshToken: 'refresh-plain' }));
    const fetchMock = mockFetch(async () => okJson({ access_token: NEW_ACCESS, expires_in: 3600 }));
    await getFreshAccessToken('user-1');
    expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams).get('refresh_token')).toBe('refresh-plain');
    const { data } = db.integrationAccount.update.mock.calls[0][0];
    expect(decryptToken(data.refreshToken)).toBe('refresh-plain');
    expect(data.refreshToken).not.toContain('refresh-plain');
  });

  it('persists a rotated refresh token when Google returns one', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => okJson({ access_token: NEW_ACCESS, expires_in: 3600, refresh_token: 'brand-new-refresh-token' }));
    await getFreshAccessToken('user-1');
    expect(decryptToken(db.integrationAccount.update.mock.calls[0][0].data.refreshToken)).toBe('brand-new-refresh-token');
  });

  it('throws NoIntegrationAccountError when no row exists', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(null);
    await expect(getFreshAccessToken('user-1')).rejects.toThrow(NoIntegrationAccountError);
  });

  it('maps invalid_grant to NeedsReconnectError, calls onNeedsReconnect, and leaks no token', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => errorResponse(400, JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })));
    const onNeedsReconnect = vi.fn();

    const err = await caught(getFreshAccessToken('user-1', { onNeedsReconnect, logger }));
    expect(err).toBeInstanceOf(NeedsReconnectError);
    // Backwards compatible with callers that handle TokenRefreshFailedError as "reconnect".
    expect(err).toBeInstanceOf(TokenRefreshFailedError);
    expect((err as NeedsReconnectError).reason).toBe('invalid_grant');
    expect(onNeedsReconnect).toHaveBeenCalledWith('user-1');
    expect(db.integrationAccount.update).not.toHaveBeenCalled();
    assertNoSecrets(err);
  });

  it('maps a plain-text invalid_grant body too', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => errorResponse(400, 'invalid_grant'));
    await expect(getFreshAccessToken('user-1')).rejects.toBeInstanceOf(NeedsReconnectError);
  });

  it('throws NeedsReconnectError without a network call when there is no refresh token', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row({ refreshToken: null }));
    const fetchMock = mockFetch(() => { throw new Error('no network'); });
    const onNeedsReconnect = vi.fn();
    const err = await caught(getFreshAccessToken('user-1', { onNeedsReconnect }));
    expect(err).toBeInstanceOf(NeedsReconnectError);
    expect((err as NeedsReconnectError).reason).toBe('no_refresh_token');
    expect(onNeedsReconnect).toHaveBeenCalledWith('user-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still throws NeedsReconnectError when the onNeedsReconnect callback fails', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row({ refreshToken: null }));
    const err = await caught(getFreshAccessToken('user-1', { onNeedsReconnect: () => { throw new Error('db down'); }, logger }));
    expect(err).toBeInstanceOf(NeedsReconnectError);
    expect(logLines.some((l) => l.includes('on_needs_reconnect_failed'))).toBe(true);
  });

  it('maps a token endpoint 5xx to a retryable ProviderUnavailableError, not a reconnect', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => errorResponse(503, 'backend error'));
    const onNeedsReconnect = vi.fn();
    const err = await caught(getFreshAccessToken('user-1', { onNeedsReconnect, logger }));
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as ProviderUnavailableError).retryable).toBe(true);
    expect((err as ProviderUnavailableError).status).toBe(503);
    expect(onNeedsReconnect).not.toHaveBeenCalled();
    assertNoSecrets(err);
  });

  it('maps a network failure or timeout to a retryable ProviderUnavailableError', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
    const err = await caught(getFreshAccessToken('user-1'));
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as ProviderUnavailableError).retryable).toBe(true);
    expect((err as ProviderUnavailableError).reason).toBe('timeout');
  });

  it('maps a 429 to RateLimitedError with Retry-After', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => errorResponse(429, '{}', { 'retry-after': '7' }));
    const err = await caught(getFreshAccessToken('user-1'));
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBe(7000);
  });

  it('maps invalid_client (operator misconfiguration) to TokenRefreshFailedError, not a reconnect', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => errorResponse(401, JSON.stringify({ error: 'invalid_client' })));
    const onNeedsReconnect = vi.fn();
    const err = await caught(getFreshAccessToken('user-1', { onNeedsReconnect }));
    expect(err).toBeInstanceOf(TokenRefreshFailedError);
    expect(err).not.toBeInstanceOf(NeedsReconnectError);
    expect(String(err.cause)).toContain('invalid_client');
    expect(onNeedsReconnect).not.toHaveBeenCalled();
  });

  it('throws TokenRefreshFailedError (no Invalid Date crash) when expires_in is missing, without leaking the token', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => okJson({ access_token: NEW_ACCESS }));
    const err = await caught(getFreshAccessToken('user-1', { logger }));
    expect(err).toBeInstanceOf(TokenRefreshFailedError);
    expect(db.integrationAccount.update).not.toHaveBeenCalled();
    assertNoSecrets(err);
  });

  it('throws TokenRefreshFailedError when expires_in is finite but absurdly large', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    mockFetch(async () => okJson({ access_token: NEW_ACCESS, expires_in: 1e300 }));
    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    expect(db.integrationAccount.update).not.toHaveBeenCalled();
  });

  it('throws TokenRefreshFailedError, without flagging reconnect, when the stored token cannot be decrypted', async () => {
    // Flip the first ciphertext character (a full 6 data bits) so GCM authentication fails.
    const [v, iv, tag, ct] = encryptToken(ACCESS).split(':');
    const tampered = [v, iv, tag, (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)].join(':');
    db.integrationAccount.findUnique.mockResolvedValue(row({ accessToken: tampered, expiresAt: new Date(Date.now() + 60 * 60 * 1000) }));
    const onNeedsReconnect = vi.fn();
    const err = await caught(getFreshAccessToken('user-1', { onNeedsReconnect, logger }));
    expect(err).toBeInstanceOf(TokenRefreshFailedError);
    expect(err).not.toBeInstanceOf(NeedsReconnectError);
    expect(onNeedsReconnect).not.toHaveBeenCalled();
    assertNoSecrets(err);
  });
});

describe('revokeGoogleToken', () => {
  it('POSTs the token to the fixed revoke endpoint', async () => {
    const fetchMock = mockFetch(async () => okJson({}));
    await expect(revokeGoogleToken(REFRESH)).resolves.toEqual({ revoked: true, alreadyInvalid: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(init.method).toBe('POST');
    expect((init.body as URLSearchParams).get('token')).toBe(REFRESH);
  });

  it('treats invalid_token as already revoked', async () => {
    mockFetch(async () => errorResponse(400, JSON.stringify({ error: 'invalid_token', error_description: 'Token expired or revoked' })));
    await expect(revokeGoogleToken(REFRESH)).resolves.toEqual({ revoked: true, alreadyInvalid: true });
  });

  it('maps 5xx to a retryable ProviderUnavailableError without leaking the token', async () => {
    mockFetch(async () => errorResponse(500, `error for ${REFRESH}`));
    const err = await caught(revokeGoogleToken(REFRESH, { logger }));
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as ProviderUnavailableError).retryable).toBe(true);
    assertNoSecrets(err);
  });
});

describe('revokeGoogleAccess', () => {
  it('revokes the decrypted refresh token for the user', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row());
    const fetchMock = mockFetch(async () => okJson({}));
    await revokeGoogleAccess('user-1');
    expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams).get('token')).toBe(REFRESH);
  });

  it('falls back to the access token when there is no refresh token', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(row({ refreshToken: null }));
    const fetchMock = mockFetch(async () => okJson({}));
    await revokeGoogleAccess('user-1');
    expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams).get('token')).toBe(ACCESS);
  });

  it('throws NoIntegrationAccountError when there is nothing to revoke', async () => {
    db.integrationAccount.findUnique.mockResolvedValue(null);
    await expect(revokeGoogleAccess('user-1')).rejects.toThrow(NoIntegrationAccountError);
  });
});
