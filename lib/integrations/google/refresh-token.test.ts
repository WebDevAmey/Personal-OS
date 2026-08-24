import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFreshAccessToken, NoIntegrationAccountError, TokenRefreshFailedError } from './refresh-token';
import { db } from '@/db/client';
import { persistIntegrationAccount } from '@/lib/auth/persist-integration-account';

vi.mock('@/db/client', () => ({
  db: { select: vi.fn() },
}));

vi.mock('@/lib/auth/persist-integration-account', () => ({
  persistIntegrationAccount: vi.fn().mockResolvedValue(undefined),
}));

const mockedDb = db as unknown as { select: ReturnType<typeof vi.fn> };
const mockedPersist = persistIntegrationAccount as unknown as ReturnType<typeof vi.fn>;

const originalFetch = global.fetch;

function mockAccountRow(overrides: Partial<{
  accessToken: string;
  refreshToken: string | null;
  scopes: string;
  expiresAt: Date | null;
}> = {}) {
  mockedDb.select.mockReturnValue({
    from: () => ({
      where: () => Promise.resolve([{
        userId: 'user-1',
        provider: 'google',
        accessToken: 'existing-access-token',
        refreshToken: 'existing-refresh-token',
        scopes: 'gmail.readonly',
        expiresAt: new Date('2026-08-25T00:00:00Z'),
        ...overrides,
      }]),
    }),
  });
}

describe('getFreshAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
    process.env.AUTH_GOOGLE_ID = 'test-client-id';
    process.env.AUTH_GOOGLE_SECRET = 'test-client-secret';
    vi.useRealTimers();
  });

  it('returns the existing access token without calling Google when it is still fresh', async () => {
    vi.setSystemTime(new Date('2026-08-25T00:00:00Z'));
    mockAccountRow({ expiresAt: new Date('2026-08-25T01:00:00Z') });
    global.fetch = vi.fn();

    const token = await getFreshAccessToken('user-1');

    expect(token).toBe('existing-access-token');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockedPersist).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('refreshes and persists a new access token when the stored one is already expired', async () => {
    vi.setSystemTime(new Date('2026-08-25T00:00:00Z'));
    mockAccountRow({ expiresAt: new Date('2026-08-24T23:00:00Z'), refreshToken: 'existing-refresh-token' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
    }) as unknown as typeof fetch;

    const token = await getFreshAccessToken('user-1');

    expect(token).toBe('new-access-token');
    expect(global.fetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST',
    }));
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = init.body as URLSearchParams;
    expect(body.get('client_id')).toBe('test-client-id');
    expect(body.get('client_secret')).toBe('test-client-secret');
    expect(body.get('refresh_token')).toBe('existing-refresh-token');
    expect(body.get('grant_type')).toBe('refresh_token');

    expect(mockedPersist).toHaveBeenCalledWith('user-1', expect.objectContaining({
      accessToken: 'new-access-token',
      refreshToken: 'existing-refresh-token',
      expiresAt: new Date('2026-08-25T01:00:00Z'),
    }));
    vi.useRealTimers();
  });

  it('refreshes when expiresAt is within the 5-minute safety margin, even though it has not technically passed yet', async () => {
    vi.setSystemTime(new Date('2026-08-25T00:00:00Z'));
    // Expires in 2 minutes - inside the 5-minute safety margin.
    mockAccountRow({ expiresAt: new Date('2026-08-25T00:02:00Z') });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
    }) as unknown as typeof fetch;

    const token = await getFreshAccessToken('user-1');

    expect(token).toBe('new-access-token');
    expect(global.fetch).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('refreshes when expiresAt is null', async () => {
    mockAccountRow({ expiresAt: null });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
    }) as unknown as typeof fetch;

    const token = await getFreshAccessToken('user-1');
    expect(token).toBe('new-access-token');
  });

  it('keeps the existing refresh token when Google does not return a new one on refresh', async () => {
    mockAccountRow({ expiresAt: new Date('2020-01-01T00:00:00Z'), refreshToken: 'existing-refresh-token' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
    }) as unknown as typeof fetch;

    await getFreshAccessToken('user-1');

    expect(mockedPersist).toHaveBeenCalledWith('user-1', expect.objectContaining({
      refreshToken: 'existing-refresh-token',
    }));
  });

  it('persists a new refresh token when Google returns one on refresh', async () => {
    mockAccountRow({ expiresAt: new Date('2020-01-01T00:00:00Z'), refreshToken: 'existing-refresh-token' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 3600, refresh_token: 'brand-new-refresh-token' }),
    }) as unknown as typeof fetch;

    await getFreshAccessToken('user-1');

    expect(mockedPersist).toHaveBeenCalledWith('user-1', expect.objectContaining({
      refreshToken: 'brand-new-refresh-token',
    }));
  });

  it('throws NoIntegrationAccountError when the user has no google integration_accounts row', async () => {
    mockedDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });

    await expect(getFreshAccessToken('user-without-account')).rejects.toThrow(NoIntegrationAccountError);
    expect(mockedPersist).not.toHaveBeenCalled();
  });

  it('throws TokenRefreshFailedError when Google rejects the refresh request', async () => {
    mockAccountRow({ expiresAt: new Date('2020-01-01T00:00:00Z') });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    }) as unknown as typeof fetch;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    expect(mockedPersist).not.toHaveBeenCalled();
  });

  it('throws TokenRefreshFailedError when there is no refresh token to use', async () => {
    mockAccountRow({ expiresAt: new Date('2020-01-01T00:00:00Z'), refreshToken: null });
    global.fetch = vi.fn();

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Finding 3: a response missing `expires_in` must throw a typed
  // TokenRefreshFailedError instead of silently producing `new Date(NaN)`
  // (Invalid Date), which drizzle's timestamp encoder throws a raw,
  // untyped RangeError on - a crash that escapes the route's
  // `instanceof TokenRefreshFailedError` guard and produces a raw 500.
  //
  // It also must NOT leak the live access_token value into the error
  // message - `data` is a *successful* token response, so only its shape
  // (types/keys) is safe to put in a message that ends up in server logs.
  it('throws TokenRefreshFailedError when the response is missing expires_in, without leaking the access_token value', async () => {
    mockAccountRow({ expiresAt: new Date('2020-01-01T00:00:00Z') });
    const liveAccessToken = 'ya29.super-secret-live-access-token';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: liveAccessToken }),
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await getFreshAccessToken('user-1');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TokenRefreshFailedError);
    const err = caught as TokenRefreshFailedError;
    const fullErrorText = `${err.message} ${String(err.cause)}`;
    expect(fullErrorText).not.toContain(liveAccessToken);
    expect(mockedPersist).not.toHaveBeenCalled();
  });

  it('throws TokenRefreshFailedError when expires_in is not a valid number', async () => {
    mockAccountRow({ expiresAt: new Date('2020-01-01T00:00:00Z') });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 'soon' }),
    }) as unknown as typeof fetch;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    expect(mockedPersist).not.toHaveBeenCalled();
  });

  // Finding 1 (hardening): `Number.isFinite(1e300)` is `true`, but
  // `new Date(Date.now() + 1e300 * 1000)` is an Invalid Date, which
  // drizzle's timestamp encoder throws an untyped RangeError on when
  // persisting. The *result* of the expires_in math must be validated too,
  // not just the input's type/finiteness.
  it('throws TokenRefreshFailedError when expires_in is finite but absurdly large', async () => {
    mockAccountRow({ expiresAt: new Date('2020-01-01T00:00:00Z') });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 1e300 }),
    }) as unknown as typeof fetch;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    expect(mockedPersist).not.toHaveBeenCalled();
  });

  // Finding 2 (hardening): a 2xx response with no access_token would
  // otherwise pass `undefined` through to `persistIntegrationAccount`,
  // which hits the `access_token` NOT NULL constraint and throws an
  // untyped DB error - the same escape-the-instanceof-guard problem.
  it('throws TokenRefreshFailedError when the response is missing access_token', async () => {
    mockAccountRow({ expiresAt: new Date('2020-01-01T00:00:00Z') });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ expires_in: 3600 }),
    }) as unknown as typeof fetch;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    expect(mockedPersist).not.toHaveBeenCalled();
  });
});
