import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGoogleAuthUrl, exchangeGoogleCode } from './google-oauth';

describe('buildGoogleAuthUrl', () => {
  it('requests the Gmail and Calendar scopes alongside identity, with offline access', () => {
    const url = new URL(buildGoogleAuthUrl('state-123'));
    const scope = url.searchParams.get('scope');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.compose');
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(scope).toContain('openid');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-123');
  });
});

describe('exchangeGoogleCode', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = originalFetch; });

  it('posts the code to Google\'s token endpoint and returns the parsed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok', refresh_token: 'refresh', expires_in: 3600, id_token: 'idtok' }),
    }) as unknown as typeof fetch;

    const result = await exchangeGoogleCode('auth-code-123');
    expect(result.access_token).toBe('tok');
    expect(global.fetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({ method: 'POST' }));
  });
});
