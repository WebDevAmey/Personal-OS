// app/api/auth/reset-password/route.ts
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';

const Schema = z.object({ email: z.string().email(), code: z.string().length(6), newPassword: z.string().min(8) });

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { email, code, newPassword } = parsed.data;

  const token = await prisma.verificationToken.findFirst({
    where: { email, type: 'PASSWORD_RESET', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) {
    return Response.json({ error: 'Code expired or not found. Request a new one.' }, { status: 400 });
  }
  // Cap guesses per token so a 6-digit code (1,000,000 possibilities) can't be
  // brute-forced within its 10-minute validity window (mirrors verify-otp).
  if (token.attempts >= MAX_ATTEMPTS) {
    return Response.json({ error: 'Too many incorrect attempts. Request a new code.' }, { status: 400 });
  }

  const correct = await bcrypt.compare(code, token.otpHash);
  if (!correct) {
    await prisma.verificationToken.update({ where: { id: token.id }, data: { attempts: token.attempts + 1 } });
    return Response.json({ error: 'Incorrect code' }, { status: 400 });
  }

  const newHash = await hashPassword(newPassword);
  // sessionVersion.increment: signs the user out of every existing session —
  // a password reset is exactly the case getSession()'s revocation check exists for.
  await prisma.user.update({ where: { email }, data: { password: newHash, sessionVersion: { increment: 1 } } });
  await prisma.verificationToken.delete({ where: { id: token.id } });

  return Response.json({ message: 'Password reset. Please sign in again.' });
}
