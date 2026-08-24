import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';
import { NoIntegrationAccountError, TokenRefreshFailedError } from '@/lib/integrations/google/refresh-token';

vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }) }));
const mockGetFreshAccessToken = vi.fn().mockResolvedValue('tok');
vi.mock('@/lib/integrations/google/refresh-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/integrations/google/refresh-token')>();
  return { ...actual, getFreshAccessToken: (...args: Parameters<typeof actual.getFreshAccessToken>) => mockGetFreshAccessToken(...args) };
});
vi.mock('@/lib/ai/orchestrator', () => ({ runCommand: vi.fn().mockResolvedValue({ message: 'Moved it to Friday.' }) }));

describe('POST /api/command', () => {
  it('returns the orchestrator\'s confirmation message for a signed-in user', async () => {
    const req = new Request('http://localhost/api/command', {
      method: 'POST',
      body: JSON.stringify({ input: 'Move the assignment to Friday' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json).toEqual({ message: 'Moved it to Friday.' });
  });

  it('returns 401 when there is no session', async () => {
    const { auth } = await import('@/auth');
    // NextAuth v5's `auth` export has multiple overloaded call signatures
    // (plain call vs. middleware vs. route-handler wrapper), which defeats
    // `vi.mocked(auth)`'s overload resolution for `mockResolvedValueOnce`.
    // The `any` cast here (as in the task brief) sidesteps that ambiguity;
    // it's the mock itself being reshaped, not runtime behavior.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValueOnce(null);
    const req = new Request('http://localhost/api/command', { method: 'POST', body: JSON.stringify({ input: 'hi' }) });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // Finding 2: previously this dereferenced `account.accessToken` directly
  // off a possibly-empty db.select() result, an opaque crash when the row
  // is missing. Now getFreshAccessToken throws a named error the route can
  // catch and turn into an actionable message instead of a 500.
  it('returns a friendly reconnect message (HTTP 200) when the user has no google integration account', async () => {
    mockGetFreshAccessToken.mockRejectedValueOnce(new NoIntegrationAccountError('user-1'));
    const req = new Request('http://localhost/api/command', { method: 'POST', body: JSON.stringify({ input: 'hi' }) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toMatch(/reconnect|sign in again/i);
  });

  it('returns a friendly reconnect message (HTTP 200) when the Google token refresh fails', async () => {
    mockGetFreshAccessToken.mockRejectedValueOnce(new TokenRefreshFailedError('user-1'));
    const req = new Request('http://localhost/api/command', { method: 'POST', body: JSON.stringify({ input: 'hi' }) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toMatch(/reconnect|sign in again/i);
  });
});
