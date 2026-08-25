// app/api/auth/forgot-password/route.ts
import { z } from 'zod';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetOtp } from '@/lib/auth/otp';

const Schema = z.object({ email: z.string().email() });

// Minimum gap between freshly-issued PASSWORD_RESET tokens for the same
// email. Without this, an attacker can mint unlimited fresh 10-minute /
// 5-attempt OTP windows for any email, defeating the per-token attempt cap.
const REISSUE_THROTTLE_MS = 60_000;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { email } = parsed.data;

  // Scheduled via after() rather than awaited so the exists- and
  // not-exists-paths return in roughly the same time: awaiting the
  // bcrypt hash + DB insert + outbound Resend call inline here would make
  // response timing a reliable oracle for whether `email` is registered.
  after(async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return;

    // Throttle issuance: skip minting a new token if an unexpired one was
    // already created for this email within the last minute. This caps an
    // attacker to one fresh 10-minute/5-attempt guessing window per minute
    // per email, rather than unlimited windows via repeated requests here.
    const recentToken = await prisma.verificationToken.findFirst({
      where: {
        email,
        type: 'PASSWORD_RESET',
        createdAt: { gt: new Date(Date.now() - REISSUE_THROTTLE_MS) },
      },
    });
    if (recentToken) return;

    await sendPasswordResetOtp(email);
  });

  // Always 200, whether or not the account exists — prevents email enumeration.
  return Response.json({ message: 'If that email is registered, a reset code has been sent.' });
}
