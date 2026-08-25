// app/api/auth/forgot-password/route.ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetOtp } from '@/lib/auth/otp';

const Schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    await sendPasswordResetOtp(parsed.data.email);
  }
  // Always 200, whether or not the account exists — prevents email enumeration.
  return Response.json({ message: 'If that email is registered, a reset code has been sent.' });
}
