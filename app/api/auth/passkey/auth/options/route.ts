// app/api/auth/passkey/auth/options/route.ts
// Passkey sign-in options for discoverable credentials.
//
// `allowCredentials` is empty: the authenticator offers the user's own
// resident credentials, so no credential ids (anyone's) are disclosed
// (SEC-B-004). The challenge is bound to this browser by an HttpOnly cookie
// (see lib/auth/passkey-challenge.ts, SEC-B-003). Per-IP rate limited, and
// expired challenge rows are swept on each call.
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { RP_ID } from '@/lib/auth/webauthn';
import { createAuthChallenge, sweepExpiredChallenges } from '@/lib/auth/passkey-challenge';
import { noStoreHeaders } from '@/lib/auth/http';
import { assertSameOrigin } from '@/lib/security/csrf';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';
import { recordAuthEvent } from '@/lib/audit/auth-events';

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  const limit = await checkAuthRateLimit('passkey-options', { ip: clientIp(req) });
  if (!limit.allowed) {
    await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', req, metadata: { route: 'passkey-options' } });
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  await sweepExpiredChallenges();

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: [],
    userVerification: 'required',
  });

  const { cookie } = await createAuthChallenge(options.challenge);
  return Response.json(options, { headers: noStoreHeaders({ 'Set-Cookie': cookie }) });
}
