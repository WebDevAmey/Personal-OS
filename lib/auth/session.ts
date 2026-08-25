// lib/auth/session.ts
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, verifySessionToken } from './jwt';

export async function getSession(): Promise<{ userId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { sessionVersion: true } });
  if (!user || user.sessionVersion !== payload.sessionVersion) return null;

  return { userId: payload.userId };
}
