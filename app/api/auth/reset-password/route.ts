// app/api/auth/reset-password/route.ts
// Consumes a password-reset code together with the new password.
//
// Guess limits (SEC-B-002): 5 per token (atomic reservation) and 10 per email
// per 24 h across all tokens (ADR-012 limiter), plus a per-IP limit. With
// 6-digit codes that caps an attacker at about 10 in 1,000,000 per day per
// email, however many codes are issued.
//
// On success (SEC-B-023): new password, lockout cleared, every reset code for
// the email deleted, sessionVersion bumped (all sessions revoked) and the
// caller's session cookie cleared, so the user signs in again with the new
// password.
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { hashPassword, NewPasswordSchema } from '@/lib/auth/password';
import { OTP_MAX_ATTEMPTS } from '@/lib/auth/otp';
import { clearSessionCookie } from '@/lib/auth/cookies';
import { EmailSchema, fieldNames, findUserByEmail, invalidInput, noStoreHeaders, readJson } from '@/lib/auth/http';
import { csrfGuard } from '@/lib/security/csrf';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';
import { recordAuthEvent } from '@/lib/audit/auth-events';

const Schema = z.object({
  email: EmailSchema,
  code: z.string().regex(/^\d{6}$/),
  newPassword: NewPasswordSchema,
});

function rejected(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: noStoreHeaders() });
}

export async function POST(req: Request) {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return invalidInput(fieldNames(parsed.error));
  const { email, code, newPassword } = parsed.data;

  // Counted before the token lookup, so every guess for this email uses up
  // the 24 h budget whether or not a code currently exists.
  const limit = await checkAuthRateLimit('reset-password', { ip: clientIp(req), email });
  if (!limit.allowed) {
    await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', req, email, metadata: { route: 'reset-password', scope: limit.scope ?? null } });
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  const token = await prisma.verificationToken.findFirst({
    where: { email, type: 'PASSWORD_RESET', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) {
    await recordAuthEvent({ event: 'PASSWORD_RESET_FAILED', req, email, metadata: { reason: 'no_token' } });
    return rejected('Code expired or not found. Request a new one.');
  }

  const reserved = await prisma.verificationToken.updateMany({
    where: { id: token.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) {
    await recordAuthEvent({ event: 'PASSWORD_RESET_FAILED', req, email, metadata: { reason: 'attempts_exhausted' } });
    return rejected('Too many incorrect attempts. Request a new code.');
  }

  if (!(await bcrypt.compare(code, token.otpHash))) {
    await recordAuthEvent({ event: 'PASSWORD_RESET_FAILED', req, email, metadata: { reason: 'wrong_code' } });
    return rejected('Incorrect code');
  }

  const user = await findUserByEmail(email);
  // Single use: only the request that deletes the token row proceeds.
  const consumed = await prisma.verificationToken.deleteMany({ where: { id: token.id } });
  if (!user || consumed.count === 0) {
    return rejected('Code expired or not found. Request a new one.');
  }

  const newHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        password: newHash,
        // Receiving the code proves control of the address.
        emailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        sessionVersion: { increment: 1 },
      },
    }),
    prisma.verificationToken.deleteMany({ where: { email, type: 'PASSWORD_RESET' } }),
  ]);

  await recordAuthEvent({ event: 'PASSWORD_RESET_COMPLETED', req, userId: user.id, email });
  return Response.json(
    { message: 'Password reset. Please sign in again.' },
    { headers: noStoreHeaders({ 'Set-Cookie': clearSessionCookie() }) },
  );
}
