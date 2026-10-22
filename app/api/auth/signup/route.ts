// app/api/auth/signup/route.ts
// Email + password sign-up.
//
// Account pre-hijack defence (SEC-B-005) and enumeration defence (SEC-B-006):
// - No User row is created here. The chosen password is hashed and held in
//   the SIGN_UP VerificationToken's payload; the account is created (or a
//   legacy unverified row gets its password) only when the emailed code is
//   confirmed from the same browser (binding cookie). An unverified sign-up
//   therefore neither blocks nor owns the email.
// - The response is identical whether or not the email is registered. The
//   database work and email happen after the response (`after()`); an
//   already-verified owner gets a notice instead of a code.
import { z } from 'zod';
import { after } from 'next/server';
import { hashPassword, NewPasswordSchema } from '@/lib/auth/password';
import {
  hashBinding,
  newBindingSecret,
  sendExistingAccountNotice,
  sendSignUpOtp,
  SIGNUP_BINDING_COOKIE,
  SIGNUP_BINDING_MAX_AGE_SECONDS,
} from '@/lib/auth/otp';
import { EmailSchema, fieldNames, findUserByEmail, invalidInput, noStoreHeaders, readJson } from '@/lib/auth/http';
import { buildCookie } from '@/lib/auth/cookies';
import { csrfGuard } from '@/lib/security/csrf';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';
import { recordAuthEvent } from '@/lib/audit/auth-events';
import { logger } from '@/lib/observability/logger';

const SignUpSchema = z.object({
  email: EmailSchema,
  password: NewPasswordSchema,
  name: z.string().trim().max(100).optional(),
});

export async function POST(req: Request) {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const parsed = SignUpSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidInput(fieldNames(parsed.error));
  const { email, password, name } = parsed.data;

  const limit = await checkAuthRateLimit('signup', { ip: clientIp(req), email });
  if (!limit.allowed) {
    await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', req, email, metadata: { route: 'signup', scope: limit.scope ?? null } });
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  // Hashed on every path so timing does not depend on whether the email exists.
  const passwordHash = await hashPassword(password);
  const binding = newBindingSecret();

  after(async () => {
    try {
      const existing = await findUserByEmail(email);
      if (existing?.emailVerified) {
        await sendExistingAccountNotice(existing.email);
        await recordAuthEvent({ event: 'SIGN_UP', req, userId: existing.id, email, metadata: { outcome: 'existing_account_notified' } });
        return;
      }
      await sendSignUpOtp(email, { passwordHash, name: name ?? null, bindingHash: hashBinding(binding) });
      await recordAuthEvent({ event: 'OTP_SENT', req, userId: existing?.id ?? null, email, metadata: { type: 'SIGN_UP' } });
    } catch (error) {
      logger.error('signup.deferred_failed', { error });
    }
  });

  const cookie = buildCookie(SIGNUP_BINDING_COOKIE, binding, { maxAgeSeconds: SIGNUP_BINDING_MAX_AGE_SECONDS });
  return Response.json(
    { message: 'Check your email for a verification code.' },
    { headers: noStoreHeaders({ 'Set-Cookie': cookie }) },
  );
}
