// app/api/auth/passkey/auth/verify/route.ts
// Passkey sign-in verification (SEC-B-003).
//
// 1. The challenge is the one named by THIS browser's HttpOnly challenge
//    cookie, deleted atomically before verification: single use on success
//    and on failure, and never another ceremony's challenge.
// 2. `response.id` must equal `response.rawId` (and `credentialId`, if sent).
// 3. The authenticator's `userHandle` must be present and identify the
//    credential's owner.
// 4. @simplewebauthn verifies origin, RP ID, user verification, signature and
//    counter; the stored counter is then updated.
// Responds with JSON (not a redirect) so the fetch() caller can navigate.
import { z } from 'zod';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { prisma } from '@/lib/prisma';
import { RP_ID, ORIGIN, userIdToUserHandle } from '@/lib/auth/webauthn';
import { clearAuthChallengeCookie, consumeAuthChallenge, readAuthChallengeId } from '@/lib/auth/passkey-challenge';
import { createSessionCookie } from '@/lib/auth/session';
import { noStoreHeaders, readJson } from '@/lib/auth/http';
import { csrfGuard } from '@/lib/security/csrf';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';
import { recordAuthEvent } from '@/lib/audit/auth-events';

const Schema = z.object({
  response: z
    .object({
      id: z.string().min(1).max(1024),
      rawId: z.string().min(1).max(1024),
      type: z.literal('public-key'),
      response: z
        .object({
          clientDataJSON: z.string(),
          authenticatorData: z.string(),
          signature: z.string(),
          userHandle: z.string().optional(),
        })
        .passthrough(),
    })
    .passthrough(),
  credentialId: z.string().optional(),
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function POST(req: Request) {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const headers = noStoreHeaders();
  // The challenge cookie is single use: cleared on every outcome below.
  headers.append('Set-Cookie', clearAuthChallengeCookie());
  const failure = async (reason: string, userId?: string) => {
    await recordAuthEvent({ event: 'PASSKEY_LOGIN_FAILURE', req, userId, metadata: { reason } });
    return Response.json({ error: 'Passkey verification failed' }, { status: 400, headers });
  };

  const limit = await checkAuthRateLimit('passkey-verify', { ip: clientIp(req) });
  if (!limit.allowed) {
    await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', req, metadata: { route: 'passkey-verify' } });
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  const challengeId = readAuthChallengeId(req);
  if (!challengeId) return failure('missing_challenge_cookie');
  // Consumed before parsing or verifying, so even a malformed attempt burns it.
  const expectedChallenge = await consumeAuthChallenge(challengeId);

  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) {
    await recordAuthEvent({ event: 'PASSKEY_LOGIN_FAILURE', req, metadata: { reason: 'invalid_input' } });
    return Response.json({ error: 'Invalid input' }, { status: 400, headers });
  }
  if (!expectedChallenge) return failure('challenge_expired_or_used');

  const { response, credentialId } = parsed.data;
  if (response.id !== response.rawId || (credentialId !== undefined && credentialId !== response.id)) {
    return failure('credential_id_mismatch');
  }

  const credential = await prisma.passkeyCredential.findUnique({ where: { id: response.id } });
  if (!credential) return failure('unknown_credential');

  const userHandle = response.response.userHandle;
  let handleBytes: Uint8Array;
  try {
    handleBytes = userHandle ? isoBase64URL.toBuffer(userHandle) : new Uint8Array();
  } catch {
    return failure('user_handle_invalid', credential.userId);
  }
  if (!userHandle || !bytesEqual(handleBytes, userIdToUserHandle(credential.userId))) {
    return failure('user_handle_mismatch', credential.userId);
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransport[],
      },
    });
  } catch {
    // Includes counter regression (possible cloned authenticator).
    return failure('verification_error', credential.userId);
  }
  if (!verification.verified || !verification.authenticationInfo) {
    return failure('not_verified', credential.userId);
  }

  await prisma.passkeyCredential.update({
    where: { id: credential.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });

  const user = await prisma.user.findUnique({ where: { id: credential.userId }, select: { id: true, email: true, sessionVersion: true } });
  if (!user) return failure('user_missing');

  headers.append('Set-Cookie', await createSessionCookie(user));
  await recordAuthEvent({ event: 'PASSKEY_LOGIN_SUCCESS', req, userId: user.id, email: user.email, metadata: { method: 'passkey' } });
  return Response.json({ message: 'Signed in', redirectTo: '/today' }, { headers });
}
