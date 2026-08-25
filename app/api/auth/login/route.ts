// app/api/auth/login/route.ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth/password';
import { signSessionToken } from '@/lib/auth/jwt';

const LoginSchema = z.object({ email: z.string().email(), password: z.string() });
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) {
    return Response.json({ error: 'Incorrect email or password' }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return Response.json({ error: 'Account temporarily locked due to failed login attempts' }, { status: 423 });
  }

  // A lockout that has elapsed has been served -- the attempt budget resets,
  // it doesn't keep accumulating from before the lock.
  const priorAttempts = user.lockedUntil ? 0 : user.failedLoginAttempts;

  const correct = await verifyPassword(password, user.password);
  if (!correct) {
    const failedLoginAttempts = priorAttempts + 1;
    const data: { failedLoginAttempts: number; lockedUntil?: Date } = { failedLoginAttempts };
    if (failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
    }
    await prisma.user.update({ where: { id: user.id }, data });
    return Response.json({ error: 'Incorrect email or password' }, { status: 401 });
  }

  if (!user.emailVerified) {
    return Response.json({ error: 'Please verify your email before signing in' }, { status: 403 });
  }

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  }

  const token = await signSessionToken({ userId: user.id, sessionVersion: user.sessionVersion });
  const isProd = process.env.NODE_ENV === 'production';
  const cookie = `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;

  return Response.json({ message: 'Signed in' }, { headers: { 'Set-Cookie': cookie } });
}
