// app/api/auth/passkey/register/verify/route.ts
import { z } from 'zod';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { RP_ID, ORIGIN } from '@/lib/auth/webauthn';

// `response` is the opaque RegistrationResponseJSON produced by the
// browser's navigator.credentials.create() call (via @simplewebauthn/browser).
// Its exact shape isn't validated here -- verifyRegistrationResponse() below
// does full structural + cryptographic validation and is the real gate.
const Schema = z.object({
  response: z.object({}).passthrough(),
  name: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  // Unauthenticated callers are rejected before touching the database or
  // the WebAuthn library at all.
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { response, name } = parsed.data;

  // Scoped to the signed-in user's id -- this can only ever consume a
  // challenge that options/route.ts issued to THIS session, never a
  // challenge belonging to another user. expiresAt enforces the 5-minute
  // TTL set when the challenge was created.
  const challengeRecord = await prisma.webAuthnChallenge.findFirst({
    where: { userId: session.userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!challengeRecord) return Response.json({ error: 'Challenge expired or not found' }, { status: 400 });

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      // Safe: verifyRegistrationResponse performs the real structural and
      // cryptographic validation of this payload and throws (caught below)
      // or reports verified: false on anything malformed.
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch {
    // The library throws (rather than resolving verified: false) on a
    // structurally malformed response, e.g. a missing credential id. Treat
    // that the same as a failed verification instead of letting it surface
    // as an unhandled 500. The challenge is intentionally left intact so a
    // legitimate client can retry within the TTL.
    return Response.json({ error: 'Passkey verification failed' }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: 'Passkey verification failed' }, { status: 400 });
  }

  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
  await prisma.passkeyCredential.create({
    data: {
      id: credential.id,
      userId: session.userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      backedUp: credentialBackedUp,
      deviceType: credentialDeviceType,
      name,
    },
  });

  // Single-use: delete the challenge now that it has been consumed by a
  // successful verification, so it can never be replayed.
  await prisma.webAuthnChallenge.delete({ where: { id: challengeRecord.id } });

  return Response.json({ message: 'Passkey registered' });
}
