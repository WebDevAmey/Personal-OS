// app/api/auth/login/route.ts
// Password sign-in (docs/02 §3.1).
//
// - CSRF: same-origin + JSON required (login CSRF, SEC-B-010).
// - ADR-012 limits per IP and per email hash → 429 with Retry-After.
// - Unknown email, OAuth-only account, wrong password and locked account all
//   return the same 401 body after the same bcrypt work (SEC-B-006).
// - Attempts are reserved atomically before bcrypt runs, so parallel guesses
//   cannot exceed the lockout budget (SEC-B-001).
// - A fresh session token is minted on every successful sign-in.
import { z } from 'zod';
import { burnPasswordCheck, LoginPasswordSchema, verifyPassword } from '@/lib/auth/password';
import { clearFailedAttempts, reservePasswordAttempt } from '@/lib/auth/lockout';
import { EmailSchema, findUserByEmail, invalidInput, noStoreHeaders, readJson } from '@/lib/auth/http';
import { createSessionCookie } from '@/lib/auth/session';
import { csrfGuard } from '@/lib/security/csrf';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';
import { recordAuthEvent } from '@/lib/audit/auth-events';

const LoginSchema = z.object({ email: EmailSchema, password: LoginPasswordSchema });

const GENERIC_FAILURE = 'Incorrect email or password';

function failure(): Response {
  return Response.json({ error: GENERIC_FAILURE }, { status: 401, headers: noStoreHeaders() });
}

export async function POST(req: Request) {
  const blocked = csrfGuard(req);
  if (blocked) {
    await recordAuthEvent({ event: 'CSRF_BLOCKED', req, metadata: { route: 'login' } });
    return blocked;
  }

  const parsed = LoginSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidInput();
  const { email, password } = parsed.data;

  const limit = await checkAuthRateLimit('login', { ip: clientIp(req), email });
  if (!limit.allowed) {
    await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', req, email, metadata: { scope: limit.scope ?? null } });
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  const user = await findUserByEmail(email);
  if (!user || !user.password) {
    await burnPasswordCheck(password);
    await recordAuthEvent({ event: 'LOGIN_FAILURE', req, email, metadata: { reason: user ? 'no_password' : 'unknown_user' } });
    return failure();
  }

  const reservation = await reservePasswordAttempt(user.id);
  if (!reservation.reserved) {
    await burnPasswordCheck(password);
    await recordAuthEvent({ event: 'LOGIN_FAILURE', req, userId: user.id, email, metadata: { reason: 'locked' } });
    return failure();
  }

  const correct = await verifyPassword(password, user.password);
  if (!correct) {
    await recordAuthEvent({ event: 'LOGIN_FAILURE', req, userId: user.id, email, metadata: { reason: 'wrong_password', attempt: reservation.attempt } });
    if (reservation.lockedNow) {
      await recordAuthEvent({ event: 'ACCOUNT_LOCKED', req, userId: user.id, email });
    }
    return failure();
  }

  await clearFailedAttempts(user.id);

  // Only legacy rows can be unverified: sign-up now creates the user after
  // the emailed code is confirmed (SEC-B-005).
  if (!user.emailVerified) {
    await recordAuthEvent({ event: 'LOGIN_FAILURE', req, userId: user.id, email, metadata: { reason: 'email_not_verified' } });
    return Response.json(
      { error: 'Please verify your email before signing in', code: 'EMAIL_NOT_VERIFIED' },
      { status: 403, headers: noStoreHeaders() },
    );
  }

  const cookie = await createSessionCookie(user);
  await recordAuthEvent({ event: 'LOGIN_SUCCESS', req, userId: user.id, email, metadata: { method: 'password' } });
  return Response.json({ message: 'Signed in' }, { headers: noStoreHeaders({ 'Set-Cookie': cookie }) });
}
