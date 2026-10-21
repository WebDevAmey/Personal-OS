import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGoogleAuthUrl, exchangeGoogleCode, SCOPES } from './google-oauth';

describe('buildGoogleAuthUrl', () => {
  it('requests the Gmail and Calendar scopes alongside identity, with offline access', () => {
    const url = new URL(buildGoogleAuthUrl('state-123', 'challenge-abc'));
    const scope = url.searchParams.get('scope');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.compose');
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(scope).toContain('openid');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('requests exactly the ADR-011 scopes: no send, no calendar write (T-OAUTH-08)', () => {
    expect(SCOPES.split(' ').sort()).toEqual(
      [
        'email',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.readonly',
        'openid',
        'profile',
      ].sort(),
    );
  });

  it('sends a PKCE S256 code challenge (SEC-B-021)', () => {
    const url = new URL(buildGoogleAuthUrl('s', 'challenge-abc'));
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('exchangeGoogleCode', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it("posts the code and PKCE verifier to Google's token endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok', refresh_token: 'refresh', expires_in: 3600, id_token: 'idtok' }),
    }) as unknown as typeof fetch;

    const result = await exchangeGoogleCode('auth-code-123', 'verifier-xyz');
    expect(result.access_token).toBe('tok');
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get('code_verifier')).toBe('verifier-xyz');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('throws on a non-2xx status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;
    await expect(exchangeGoogleCode('c', 'v')).rejects.toThrow(/400/);
  });

  it('throws when the response lacks an access or ID token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok' }) }) as unknown as typeof fetch;
    await expect(exchangeGoogleCode('c', 'v')).rejects.toThrow(/id_token/);
  });
});
