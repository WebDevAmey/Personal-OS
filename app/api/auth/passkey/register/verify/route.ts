// app/api/auth/passkey/register/verify/route.ts
// Verifies a passkey registration for the signed-in user.
//
// The user's registration challenge is consumed atomically before
// verification (single use, success or failure; the client asks for new
// options to retry). The challenge only exists after options/route.ts checked
// for a recent sign-in or a re-entered password (SEC-R-005).
//
// Adding a credential does NOT bump sessionVersion: signing the owner out
// everywhere would only help someone who registered a passkey with a stolen
// session (the real user is logged out, the attacker keeps a cookie).
// Removing a credential or "sign out everywhere" is what revokes sessions.
import { z } from 'zod';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { RP_ID, ORIGIN } from '@/lib/auth/webauthn';
import { consumeRegistrationChallenge } from '@/lib/auth/passkey-challenge';
import { invalidInput, noStoreHeaders, readJson } from '@/lib/auth/http';
import { csrfGuard } from '@/lib/security/csrf';
import { recordAuthEvent } from '@/lib/audit/auth-events';

// `response` is the opaque RegistrationResponseJSON produced by the
// browser's navigator.credentials.create() call (via @simplewebauthn/browser).
// verifyRegistrationResponse() does full structural + cryptographic
// validation and is the real gate.
const Schema = z.object({
  response: z.object({}).passthrough(),
  name: z.string().trim().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  // Unauthenticated callers are rejected before touching the database or
  // the WebAuthn library at all.
  const session = await requireUser(req);
  if (session instanceof Response) return session;

  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return invalidInput();
  const { response, name } = parsed.data;

  // Scoped to the signed-in user's id: only a challenge issued to THIS user
  // can be consumed.
  const expectedChallenge = await consumeRegistrationChallenge(session.userId);
  if (!expectedChallenge) return Response.json({ error: 'Challenge expired or not found' }, { status: 400 });

  const failure = async (reason: string) => {
    await recordAuthEvent({ event: 'PASSKEY_LOGIN_FAILURE', req, userId: session.userId, metadata: { reason, stage: 'registration' } });
    return Response.json({ error: 'Passkey verification failed' }, { status: 400 });
  };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch {
    // The library throws on a structurally malformed response.
    return failure('verification_error');
  }

  if (!verification.verified || !verification.registrationInfo) {
    return failure('not_verified');
  }

  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
  // Transport hints are outside the signed payload; keep only strings.
  const rawTransports: unknown = credential.transports;
  const transports = Array.isArray(rawTransports)
    ? rawTransports.filter((t): t is string => typeof t === 'string')
    : [];

  await prisma.passkeyCredential.create({
    data: {
      id: credential.id,
      userId: session.userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports,
      backedUp: credentialBackedUp,
      deviceType: credentialDeviceType,
      name,
    },
  });

  await recordAuthEvent({ event: 'PASSKEY_ADDED', req, userId: session.userId });
  return Response.json({ message: 'Passkey registered' }, { headers: noStoreHeaders() });
}
