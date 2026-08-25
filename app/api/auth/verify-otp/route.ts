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
  const parsed = VerifySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { email, code, type } = parsed.data;

  const token = await prisma.verificationToken.findFirst({
    where: { email, type, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!token) {
    return Response.json({ error: 'Code expired or not found. Request a new one.' }, { status: 400 });
  }
  if (token.attempts >= MAX_ATTEMPTS) {
    return Response.json({ error: 'Too many incorrect attempts. Request a new code.' }, { status: 400 });
  }

  const correct = await bcrypt.compare(code, token.otpHash);
  if (!correct) {
    await prisma.verificationToken.update({ where: { id: token.id }, data: { attempts: token.attempts + 1 } });
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
