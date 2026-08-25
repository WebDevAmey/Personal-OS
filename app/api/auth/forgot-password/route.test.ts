import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('@/lib/auth/otp', () => ({ sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined) }));

describe('POST /api/auth/forgot-password', () => {
  // Both mocks are shared across every test in this file via the vi.mock
  // calls above. Without clearing between tests, calls accumulate and the
  // "not.toHaveBeenCalled()" assertion below would see calls made by an
  // earlier test (see login/route.test.ts for the same fix).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a reset OTP when the email exists', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } };
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });

    const req = new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const { sendPasswordResetOtp } = await import('@/lib/auth/otp');
    expect(sendPasswordResetOtp).toHaveBeenCalledWith('a@b.com');
  });

  it('returns 200 even when the email does not exist (no user enumeration)', async () => {
    const { prisma } = await import('@/lib/prisma');
    const mockedPrisma = prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } };
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@b.com' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const { sendPasswordResetOtp } = await import('@/lib/auth/otp');
    expect(sendPasswordResetOtp).not.toHaveBeenCalled();
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
