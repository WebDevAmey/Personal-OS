import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';

const VerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  type: z.enum(['SIGN_UP', 'PASSWORD_RESET']),
});

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { email, code, type } = parsed.data;

  const token = await prisma.verificationToken.findFirst({
    where: { email, type, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!token) {
    return Response.json({ error: 'Code expired or not found. Request a new one.' }, { status: 400 });
  }
  // Reserve the attempt atomically before comparing the code: reading
  // token.attempts, checking it, and writing it back later (after bcrypt.compare,
  // which takes ~60-100ms) is a check-then-act race — concurrent requests all read
  // the same starting attempts value, all pass the gate, and all write back the
  // same attempts+1, giving unlimited guesses. updateMany's WHERE clause is
  // evaluated against the current row at write time, so only as many concurrent
  // requests as remain under MAX_ATTEMPTS can ever reserve a slot.
  const reserved = await prisma.verificationToken.updateMany({
    where: { id: token.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) {
    return Response.json({ error: 'Too many incorrect attempts. Request a new code.' }, { status: 400 });
  }

  const correct = await bcrypt.compare(code, token.otpHash);
  if (!correct) {
    return Response.json({ error: 'Incorrect code' }, { status: 400 });
  }

  if (type === 'SIGN_UP') {
    await prisma.user.update({ where: { email }, data: { emailVerified: true } });
  }
  // PASSWORD_RESET: verification alone doesn't reset the password — Task 6's
  // reset-password route re-verifies via this same token record before
  // accepting a new password, and deletes it then. For SIGN_UP, consume now.
  if (type === 'SIGN_UP') {
    await prisma.verificationToken.delete({ where: { id: token.id } });
  }

  return Response.json({ message: 'Verified' });
}
