import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildGithubAuthUrl,
  exchangeGithubCode,
  fetchGithubUser,
  fetchGithubUserEmails,
  selectVerifiedEmail,
} from './github-oauth';

describe('buildGithubAuthUrl', () => {
  it('requests read:user and user:email scopes', () => {
    const url = new URL(buildGithubAuthUrl('state-123'));
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.hostname).toBe('github.com');
  });
});

describe('exchangeGithubCode', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the code to GitHub\'s token endpoint and returns the access token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'gh-token' }),
    }) as unknown as typeof fetch;

    const token = await exchangeGithubCode('code-123');
    expect(token).toBe('gh-token');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when GitHub returns a non-2xx status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    await expect(exchangeGithubCode('bad-code')).rejects.toThrow(/401/);
  });

  // Lesson 4: a malformed/incomplete token response must fail loudly here
  // rather than letting `undefined` propagate into the Authorization header
  // of the next fetch call.
  it('throws when the token response is missing access_token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
    await expect(exchangeGithubCode('code-123')).rejects.toThrow(/access_token/);
  });
});

describe('fetchGithubUser', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches the GitHub user profile', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, email: 'a@b.com', name: 'A B', avatar_url: 'https://example.com/a.png' }),
    }) as unknown as typeof fetch;

    const profile = await fetchGithubUser('gh-token');
    expect(profile.id).toBe(12345);
    expect(profile.email).toBe('a@b.com');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }) }),
    );
  });

  // GitHub returns email: null when the user has set their email to private
  // in account settings — this is a normal, expected response shape, not a
  // malformed one, and must not throw.
  it('accepts a null email (private email setting)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, email: null }),
    }) as unknown as typeof fetch;

    const profile = await fetchGithubUser('gh-token');
    expect(profile.email).toBeNull();
  });

  it('throws when GitHub returns a non-2xx status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
    await expect(fetchGithubUser('gh-token')).rejects.toThrow(/403/);
  });

  it('throws when the response is missing an id', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'a@b.com' }) }) as unknown as typeof fetch;
    await expect(fetchGithubUser('gh-token')).rejects.toThrow(/id/);
  });
});

describe('fetchGithubUserEmails', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches the /user/emails list', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { email: 'primary@b.com', primary: true, verified: true },
        { email: 'secondary@b.com', primary: false, verified: true },
      ],
    }) as unknown as typeof fetch;

    const emails = await fetchGithubUserEmails('gh-token');
    expect(emails).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/user/emails',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }) }),
    );
  });

  it('throws when GitHub returns a non-2xx status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    await expect(fetchGithubUserEmails('gh-token')).rejects.toThrow(/401/);
  });

  it('throws when the response is not an array', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
    await expect(fetchGithubUserEmails('gh-token')).rejects.toThrow(/array/);
  });
});

// Lesson 1: /user's bare `email` field can be null and carries no
// verification signal. selectVerifiedEmail is the ONLY sanctioned path for
// turning a /user/emails list into the address used for account lookup.
describe('selectVerifiedEmail', () => {
  it('picks the entry marked both primary and verified', () => {
    const email = selectVerifiedEmail([
      { email: 'unverified@b.com', primary: false, verified: false },
      { email: 'secondary-verified@b.com', primary: false, verified: true },
      { email: 'primary@b.com', primary: true, verified: true },
    ]);
    expect(email).toBe('primary@b.com');
  });

  it('falls back to the first verified email when no primary is marked verified', () => {
    const email = selectVerifiedEmail([
      { email: 'primary-unverified@b.com', primary: true, verified: false },
      { email: 'secondary-verified@b.com', primary: false, verified: true },
    ]);
    expect(email).toBe('secondary-verified@b.com');
  });

  it('returns null when no verified email exists at all', () => {
    const email = selectVerifiedEmail([
      { email: 'a@b.com', primary: true, verified: false },
      { email: 'c@d.com', primary: false, verified: false },
    ]);
    expect(email).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(selectVerifiedEmail([])).toBeNull();
  });

  it('never trusts an unverified primary over a verified non-primary', () => {
    const email = selectVerifiedEmail([
      { email: 'attacker-claimed@b.com', primary: true, verified: false },
      { email: 'actually-verified@b.com', primary: false, verified: true },
    ]);
    expect(email).toBe('actually-verified@b.com');
  });
});
