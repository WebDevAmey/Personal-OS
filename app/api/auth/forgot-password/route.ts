// app/api/auth/forgot-password/route.ts
// Issues a password-reset code. The response is identical whether or not the
// email is registered; all lookups and the email send happen after the
// response via after(), so timing does not reveal account existence.
//
// Issuance caps (SEC-B-002), counted per email with the atomic ADR-012
// limiter so parallel requests cannot mint extra tokens:
//   - at most one new code per 60 s, and
//   - at most 5 codes per 24 h.
// Issuing a code deletes any older reset code for the email. Guesses are
// capped separately in /api/auth/reset-password (10 per email per 24 h,
// across all tokens), which bounds total brute-force odds regardless of how
// many codes were issued.
import { z } from 'zod';
import { after } from 'next/server';
import { sendPasswordResetOtp } from '@/lib/auth/otp';
import { EmailSchema, findUserByEmail, invalidInput, noStoreHeaders, readJson } from '@/lib/auth/http';
import { csrfGuard } from '@/lib/security/csrf';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';
import { recordAuthEvent } from '@/lib/audit/auth-events';
import { logger } from '@/lib/observability/logger';

const Schema = z.object({ email: EmailSchema });

const GENERIC_MESSAGE = 'If that email is registered, a reset code has been sent.';

export async function POST(req: Request) {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return invalidInput();
  const { email } = parsed.data;

  const limit = await checkAuthRateLimit('forgot-password', { ip: clientIp(req) });
  if (!limit.allowed) {
    await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', req, email, metadata: { route: 'forgot-password', scope: limit.scope ?? null } });
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  after(async () => {
    try {
      const user = await findUserByEmail(email);
      if (!user) return;

      const burst = await checkAuthRateLimit('reset-issue-burst', { email });
      if (!burst.allowed) return;
      const daily = await checkAuthRateLimit('reset-issue', { email });
      if (!daily.allowed) {
        await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', req, userId: user.id, email, metadata: { route: 'reset-issue' } });
        return;
      }

      await sendPasswordResetOtp(email);
      await recordAuthEvent({ event: 'PASSWORD_RESET_REQUESTED', req, userId: user.id, email });
    } catch (error) {
      logger.error('forgot_password.deferred_failed', { error });
    }
  });

  return Response.json({ message: GENERIC_MESSAGE }, { headers: noStoreHeaders() });
}
