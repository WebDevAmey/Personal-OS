import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFreshAccessToken, NoIntegrationAccountError, TokenRefreshFailedError } from './refresh-token';

vi.mock('@/lib/prisma', () => ({
  prisma: { integrationAccount: { findUnique: vi.fn(), update: vi.fn() } },
}));

type MockedPrisma = {
  integrationAccount: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

const originalFetch = global.fetch;

describe('getFreshAccessToken', () => {
  beforeEach(() => { global.fetch = originalFetch; vi.clearAllMocks(); });

  it('returns the existing token without a network call when still fresh', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue({
      accessToken: 'still-fresh', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() + 60 * 60 * 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn();

    const token = await getFreshAccessToken('user-1');
    expect(token).toBe('still-fresh');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes and persists a new token when expired', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue({
      accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'fresh-access-token', expires_in: 3600 }) }) as unknown as typeof fetch;

    const token = await getFreshAccessToken('user-1');
    expect(token).toBe('fresh-access-token');
    expect(mockedPrisma.integrationAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_provider: { userId: 'user-1', provider: 'google' } },
      data: expect.objectContaining({ accessToken: 'fresh-access-token' }),
    }));
  });

  it('throws NoIntegrationAccountError when no row exists', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue(null);
    await expect(getFreshAccessToken('user-1')).rejects.toThrow(NoIntegrationAccountError);
  });

  it('throws TokenRefreshFailedError when Google rejects the refresh', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue({
      accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }) as unknown as typeof fetch;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
  });

  it('throws TokenRefreshFailedError when there is no refresh token to use', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue({
      accessToken: 'stale', refreshToken: null, expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn();

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws TokenRefreshFailedError (not an Invalid Date crash) when expires_in is missing, without logging token values', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue({
      accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'secret-value-should-not-appear-in-error' }) }) as unknown as typeof fetch;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    try {
      await getFreshAccessToken('user-1');
    } catch (err) {
      const fullErrorText = `${(err as Error).message} ${String((err as TokenRefreshFailedError).cause)}`;
      expect(fullErrorText).not.toContain('secret-value-should-not-appear-in-error');
    }
  });

  it('throws TokenRefreshFailedError when expires_in is finite but absurdly large (would otherwise produce an Invalid Date)', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue({
      accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'new-access-token', expires_in: 1e300 }) }) as unknown as typeof fetch;

    await expect(getFreshAccessToken('user-1')).rejects.toThrow(TokenRefreshFailedError);
    expect(mockedPrisma.integrationAccount.update).not.toHaveBeenCalled();
  });

  it('keeps the existing refresh token when Google does not return a new one on refresh', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue({
      accessToken: 'stale', refreshToken: 'existing-refresh-token', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }) }) as unknown as typeof fetch;

    await getFreshAccessToken('user-1');
    expect(mockedPrisma.integrationAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refreshToken: 'existing-refresh-token' }),
    }));
  });

  it('persists a new refresh token when Google returns one on refresh', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as MockedPrisma;
    mockedPrisma.integrationAccount.findUnique.mockResolvedValue({
      accessToken: 'stale', refreshToken: 'existing-refresh-token', expiresAt: new Date(Date.now() - 1000), scopes: 'gmail.readonly',
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'new-access-token', expires_in: 3600, refresh_token: 'brand-new-refresh-token' }),
    }) as unknown as typeof fetch;

    await getFreshAccessToken('user-1');
    expect(mockedPrisma.integrationAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refreshToken: 'brand-new-refresh-token' }),
    }));
  });
});
