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
});
