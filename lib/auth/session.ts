// lib/auth/session.ts
// The single server-side identity source (ADR-002). Every page, route handler
// and server action that needs the signed-in user calls one of:
//
//   getSession(req?)        → { userId } | null
//   requireUser(req?)       → { userId } | Response(401)      (route handlers)
//   requirePageUser()       → { userId }, else redirect to /sign-in?callbackUrl=…  (pages)
//
// A session is valid only when the JWT verifies (HS256, iss, aud, exp) AND its
// sessionVersion equals the user's current one, so bumping
// User.sessionVersion revokes every outstanding token. middleware.ts only
// checks the signature as an early filter; it is never the authorisation
// decision.
//
// A password lockout (User.lockedUntil) deliberately does NOT end existing
// sessions: otherwise anyone who knows a user's email could sign them out by
// failing five logins (SEC-B-007).
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { buildSessionCookie, readCookie, sessionCookieName } from './cookies';
import { signSessionToken, verifySessionToken } from './jwt';
import { safeCallback } from './safe-callback';

export interface Session {
  userId: string;
}

/** Header middleware.ts sets on the forwarded request with the original path. */
export const PATHNAME_HEADER = 'x-pos-pathname';

async function tokenFromContext(req?: Request): Promise<string | null> {
  if (req) return readCookie(req, sessionCookieName());
  const store = await cookies();
  return store.get(sessionCookieName())?.value ?? null;
}

export async function getSession(req?: Request): Promise<Session | null> {
  const token = await tokenFromContext(req);
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { sessionVersion: true } });
  if (!user || user.sessionVersion !== payload.sessionVersion) return null;

  return { userId: payload.userId };
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'Authentication required', code: 'UNAUTHENTICATED' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Route-handler variant. Usage:
 *
 *   const auth = await requireUser(req);
 *   if (auth instanceof Response) return auth;
 *   auth.userId …
 */
export async function requireUser(req?: Request): Promise<Session | Response> {
  const session = await getSession(req);
  return session ?? unauthorizedResponse();
}

/**
 * Page / server-component variant: redirects to sign-in, preserving the
 * current path (from middleware's PATHNAME_HEADER, or `callbackPath`).
 */
export async function requirePageUser(callbackPath?: string): Promise<Session> {
  const session = await getSession();
  if (session) return session;
  const path = safeCallback(callbackPath ?? (await headers()).get(PATHNAME_HEADER));
  redirect(`/sign-in?callbackUrl=${encodeURIComponent(path)}`);
}

/**
 * Mints a fresh session token for `user` and returns the Set-Cookie value.
 * Called on every successful sign-in, so each login rotates the token; callers
 * that change credentials bump sessionVersion first and pass the new value.
 */
export async function createSessionCookie(user: { id: string; sessionVersion: number }): Promise<string> {
  const token = await signSessionToken({ userId: user.id, sessionVersion: user.sessionVersion });
  return buildSessionCookie(token);
}
