import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistIntegrationAccount } from './persist-integration-account';
import { db } from '@/db/client';
import { integrationAccounts } from '@/db/schema';

vi.mock('@/db/client', () => ({
  db: { insert: vi.fn(), select: vi.fn() },
}));

describe('persistIntegrationAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores the Google access/refresh tokens and requested scopes for the user', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    (db.insert as any).mockReturnValue({ values });

    await persistIntegrationAccount('user-1', {
      accessToken: 'access-xyz',
      refreshToken: 'refresh-xyz',
      scopes: 'gmail.readonly gmail.compose calendar.readonly',
      expiresAt: new Date('2026-08-25T00:00:00Z'),
    });

    expect(db.insert).toHaveBeenCalledWith(integrationAccounts);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      provider: 'google',
      accessToken: 'access-xyz',
      refreshToken: 'refresh-xyz',
      scopes: 'gmail.readonly gmail.compose calendar.readonly',
    }));

    // Verify this is a real upsert: onConflictDoUpdate must be called with the
    // (userId, provider) conflict target and a `set` clause that re-applies the
    // fresh tokens/scopes — otherwise re-authenticating would silently no-op
    // instead of refreshing stored credentials.
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: [integrationAccounts.userId, integrationAccounts.provider],
      set: expect.objectContaining({
        accessToken: 'access-xyz',
        refreshToken: 'refresh-xyz',
        scopes: 'gmail.readonly gmail.compose calendar.readonly',
        expiresAt: new Date('2026-08-25T00:00:00Z'),
      }),
    });
  });

  it('nulls out refreshToken and expiresAt when the provider omits them', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    (db.insert as any).mockReturnValue({ values });

    await persistIntegrationAccount('user-2', {
      accessToken: 'access-abc',
      scopes: 'gmail.readonly',
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      provider: 'google',
      accessToken: 'access-abc',
      refreshToken: null,
      expiresAt: null,
    }));
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.objectContaining({ refreshToken: null, expiresAt: null }),
    }));
  });
});
