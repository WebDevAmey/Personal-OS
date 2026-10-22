// app/api/auth/verify-otp/route.ts
// Confirms a SIGN_UP code and activates the account (SEC-B-005).
//
// Password-reset codes are verified only by /api/auth/reset-password, which
// consumes the code together with the new password. Verifying them here as a
// separate step would only add a second guessing endpoint.
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { bindingMatches, OTP_MAX_ATTEMPTS, readSignUpPayload, SIGNUP_BINDING_COOKIE } from '@/lib/auth/otp';
import { clearCookie, readAuthCookie } from '@/lib/auth/cookies';
import { EmailSchema, findUserByEmail, invalidInput, noStoreHeaders, readJson } from '@/lib/auth/http';
import { csrfGuard } from '@/lib/security/csrf';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';
import { recordAuthEvent } from '@/lib/audit/auth-events';

const VerifySchema = z.object({
  email: EmailSchema,
  code: z.string().regex(/^\d{6}$/),
  type: z.literal('SIGN_UP').default('SIGN_UP'),
});

function rejected(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: noStoreHeaders() });
}

export async function POST(req: Request) {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const parsed = VerifySchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidInput();
  const { email, code } = parsed.data;

  const limit = await checkAuthRateLimit('verify-otp', { ip: clientIp(req), email });
  if (!limit.allowed) {
    await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', req, email, metadata: { route: 'verify-otp', scope: limit.scope ?? null } });
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  const token = await prisma.verificationToken.findFirst({
    where: { email, type: 'SIGN_UP', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) {
    await recordAuthEvent({ event: 'OTP_FAILED', req, email, metadata: { type: 'SIGN_UP', reason: 'no_token' } });
    return rejected('Code expired or not found. Request a new one.');
  }

  // Reserve the attempt atomically before comparing: concurrent guesses can
  // never exceed OTP_MAX_ATTEMPTS in total for this token.
  const reserved = await prisma.verificationToken.updateMany({
    where: { id: token.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) {
    await recordAuthEvent({ event: 'OTP_FAILED', req, email, metadata: { type: 'SIGN_UP', reason: 'attempts_exhausted' } });
    return rejected('Too many incorrect attempts. Request a new code.');
  }

  const payload = readSignUpPayload(token.payload);
  // Only the browser that submitted the sign-up form may complete it.
  if (!payload || !bindingMatches(readAuthCookie(req, SIGNUP_BINDING_COOKIE), payload.bindingHash)) {
    await recordAuthEvent({ event: 'OTP_FAILED', req, email, metadata: { type: 'SIGN_UP', reason: 'binding_mismatch' } });
    return rejected('This code must be entered in the browser where you signed up. Please sign up again.');
  }

  if (!(await bcrypt.compare(code, token.otpHash))) {
    await recordAuthEvent({ event: 'OTP_FAILED', req, email, metadata: { type: 'SIGN_UP', reason: 'wrong_code' } });
    return rejected('Incorrect code');
  }

  // Single use: whoever deletes the row first completes the sign-up.
  const consumed = await prisma.verificationToken.deleteMany({ where: { id: token.id } });
  if (consumed.count === 0) return rejected('Code expired or not found. Request a new one.');

  const existing = await findUserByEmail(email);
  let userId: string;
  if (!existing) {
    const created = await prisma.user.create({
      data: { email, password: payload.passwordHash, name: payload.name ?? undefined, emailVerified: true },
    });
    userId = created.id;
  } else if (!existing.emailVerified) {
    // Legacy unverified row (created by the old sign-up flow, possibly by a
    // squatter): the person who proved the address takes it over with the
    // password they just chose, and any older sessions are revoked.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        password: payload.passwordHash,
        emailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        sessionVersion: { increment: 1 },
      },
    });
    userId = existing.id;
  } else {
    // Verified meanwhile (e.g. via Google). Its credentials are not changed;
    // the user can sign in or reset the password.
    userId = existing.id;
  }

  await recordAuthEvent({ event: 'OTP_VERIFIED', req, userId, email, metadata: { type: 'SIGN_UP' } });
  return Response.json(
    { message: 'Verified' },
    { headers: noStoreHeaders({ 'Set-Cookie': clearCookie(SIGNUP_BINDING_COOKIE) }) },
  );
}
