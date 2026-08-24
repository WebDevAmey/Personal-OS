import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }) }));
vi.mock('@/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([{ accessToken: 'tok', provider: 'google' }]) }) }) },
}));
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
});
