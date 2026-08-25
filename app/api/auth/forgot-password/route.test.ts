import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    verificationToken: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/auth/otp', () => ({ sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined) }));
// The real `after()` (from next/server) requires the AsyncLocalStorage request
// scope that Next.js's own routing sets up before invoking a route handler.
// These tests call POST() directly, without that wrapper, so the real
// `after()` throws "called outside a request scope". We mock it the same way
// `@/lib/prisma` is mocked: capture the scheduled task so a test can invoke
// (and await) it explicitly, simulating Next running it after the response.
vi.mock('next/server', () => ({ after: vi.fn() }));

type AfterTask = () => Promise<void>;

async function runScheduledAfterTask(): Promise<void> {
  const { after } = await import('next/server');
  const mockedAfter = after as unknown as ReturnType<typeof vi.fn>;
  const task = mockedAfter.mock.calls[mockedAfter.mock.calls.length - 1][0] as AfterTask;
  await task();
}

describe('POST /api/auth/forgot-password', () => {
  // All mocks are shared across every test in this file via the vi.mock
  // calls above. Without clearing between tests, calls accumulate and the
  // "not.toHaveBeenCalled()" assertion below would see calls made by an
  // earlier test (see login/route.test.ts for the same fix).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a reset OTP when the email exists and no recent token was issued', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn> };
      verificationToken: { findFirst: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockedPrisma.verificationToken.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // The response resolves without waiting on the OTP send — that's the
    // whole point of scheduling it via after() rather than awaiting inline
    // (Finding 2: awaiting it inline makes response timing an enumeration
    // oracle). Nothing has been sent yet at this point.
    const { sendPasswordResetOtp } = await import('@/lib/auth/otp');
    expect(sendPasswordResetOtp).not.toHaveBeenCalled();

    await runScheduledAfterTask();
    expect(sendPasswordResetOtp).toHaveBeenCalledWith('a@b.com');
  });

  it('returns 200 even when the email does not exist (no user enumeration)', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn> };
      verificationToken: { findFirst: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@b.com' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);

    await runScheduledAfterTask();
    const { sendPasswordResetOtp } = await import('@/lib/auth/otp');
    expect(sendPasswordResetOtp).not.toHaveBeenCalled();
    expect(mockedPrisma.verificationToken.findFirst).not.toHaveBeenCalled();
  });

  it('returns the identical response body regardless of whether the email is registered', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn> };
      verificationToken: { findFirst: ReturnType<typeof vi.fn> };
    };

    mockedPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1', email: 'a@b.com' });
    mockedPrisma.verificationToken.findFirst.mockResolvedValueOnce(null);
    const existsRes = await POST(
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com' }),
      }),
    );
    const existsBody: unknown = await existsRes.json();
    // Drain the scheduled after() task so its queued mockResolvedValueOnce
    // values don't leak into a later test (vi.clearAllMocks() clears call
    // counts but not queued "Once" implementations).
    await runScheduledAfterTask();

    mockedPrisma.user.findUnique.mockResolvedValueOnce(null);
    const notExistsRes = await POST(
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'nobody@b.com' }),
      }),
    );
    const notExistsBody: unknown = await notExistsRes.json();
    await runScheduledAfterTask();

    expect(existsRes.status).toBe(notExistsRes.status);
    expect(existsBody).toEqual(notExistsBody);
  });

  it('does not issue a second reset OTP within 60 seconds for the same email (throttled)', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as {
      user: { findUnique: ReturnType<typeof vi.fn> };
      verificationToken: { findFirst: ReturnType<typeof vi.fn> };
    };
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    // First call: no recent token yet, so an OTP is issued.
    mockedPrisma.verificationToken.findFirst.mockResolvedValueOnce(null);
    // Second call: a token created moments ago is found, so issuance is skipped.
    mockedPrisma.verificationToken.findFirst.mockResolvedValueOnce({
      id: 'vt-1', email: 'a@b.com', type: 'PASSWORD_RESET', createdAt: new Date(),
    });

    const makeReq = () =>
      new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com' }),
      });

    const res1 = await POST(makeReq());
    expect(res1.status).toBe(200);
    await runScheduledAfterTask();

    const res2 = await POST(makeReq());
    expect(res2.status).toBe(200);
    await runScheduledAfterTask();

    const { sendPasswordResetOtp } = await import('@/lib/auth/otp');
    expect(sendPasswordResetOtp).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.verificationToken.findFirst).toHaveBeenCalledTimes(2);
  });

  it('returns 400 for a malformed JSON body instead of throwing', async () => {
    const req = new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
