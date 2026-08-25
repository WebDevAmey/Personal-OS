// app/api/auth/passkey/register/options/route.ts
import { generateRegistrationOptions, type AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { RP_NAME, RP_ID, userIdToUserHandle } from '@/lib/auth/webauthn';

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
    // Derived deterministically from the Prisma user id (not randomly
    // generated) so the SAME user gets the SAME WebAuthn user handle across
    // every registration call and device. A future usernameless/discoverable
    // login ceremony looks a credential up by this handle, which only works
    // if it's stable and never persisted as a fresh random value.
    userID: userIdToUserHandle(user.id),
    // residentKey: 'required' ensures a discoverable credential (needed for
    // usernameless login later). userVerification: 'required' matches
    // verifyRegistrationResponse's default of requireUserVerification: true
    // -- leaving this at the library's own default ('preferred') would let an
    // authenticator that skips UV register successfully here, only to be
    // rejected by verify/route.ts with an opaque failure.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    // Prevents this user from registering the same authenticator twice.
    excludeCredentials: user.passkeyCredentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
  });

  // Clear any prior challenge rows for this user first, so "the newest
  // unexpired challenge for this user" (what verify/route.ts looks up) is
  // always unambiguous. Without this, two concurrent registration attempts
  // (e.g. two open tabs) race: whichever ceremony completes gets checked
  // against whatever is currently newest, which may belong to the OTHER
  // attempt, causing a spurious rejection. This also keeps the table from
  // growing unbounded with abandoned challenges.
  await prisma.webAuthnChallenge.deleteMany({ where: { userId: user.id } });

  // Scoped to this user (userId) and given a 5-minute TTL -- the verify
  // route (app/api/auth/passkey/register/verify/route.ts) only ever looks
  // up an unexpired challenge belonging to the SAME signed-in user, and
  // deletes it immediately on successful verification so it can't be reused.
  await prisma.webAuthnChallenge.create({
    data: { userId: user.id, challenge: options.challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });

  return Response.json(options);
}
