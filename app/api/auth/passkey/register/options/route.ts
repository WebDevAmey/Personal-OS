// app/api/auth/passkey/register/options/route.ts
import { generateRegistrationOptions, type AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { RP_NAME, RP_ID } from '@/lib/auth/webauthn';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST() {
  // Unauthenticated callers are rejected before touching the database or
  // the WebAuthn library at all -- passkey registration only ever attaches
  // a credential to an already signed-in user.
  const session = await getSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { passkeyCredentials: true },
  });
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email,
    // Prevents this user from registering the same authenticator twice.
    excludeCredentials: user.passkeyCredentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
  });

  // Scoped to this user (userId) and given a 5-minute TTL -- the verify
  // route (app/api/auth/passkey/register/verify/route.ts) only ever looks
  // up an unexpired challenge belonging to the SAME signed-in user, and
  // deletes it immediately on successful verification so it can't be reused.
  await prisma.webAuthnChallenge.create({
    data: { userId: user.id, challenge: options.challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });

  return Response.json(options);
}
