// app/api/auth/passkey/register/options/route.ts
// Starts a passkey registration for the signed-in user.
//
// Adding a passkey creates a persistent credential, so a session alone is not
// enough (SEC-R-005): the user must have signed in within RECENT_AUTH_MS, or
// re-enter their password in this request. The issued challenge (5-minute
// TTL, single use) is what verify/route.ts accepts as proof of that check.
import { z } from 'zod';
import { generateRegistrationOptions, type AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { getSessionWithAuthTime, isRecentAuth, unauthorizedResponse } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { invalidInput, noStoreHeaders } from '@/lib/auth/http';
import { burnPasswordCheck, LoginPasswordSchema, verifyPassword } from '@/lib/auth/password';
import { clearFailedAttempts, reservePasswordAttempt } from '@/lib/auth/lockout';
import { assertSameOrigin } from '@/lib/security/csrf';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';
import { recordAuthEvent } from '@/lib/audit/auth-events';
import { RP_NAME, RP_ID, userIdToUserHandle } from '@/lib/auth/webauthn';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const BodySchema = z.object({ password: LoginPasswordSchema.optional() }).strict();

function reauthRequired(): Response {
  return Response.json(
    { error: 'Please confirm it is you: sign in again or enter your password.', code: 'REAUTH_REQUIRED' },
    { status: 401, headers: noStoreHeaders() },
  );
}

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  // Unauthenticated callers are rejected before touching the database or
  // the WebAuthn library at all -- passkey registration only ever attaches
  // a credential to an already signed-in user.
  const session = await getSessionWithAuthTime(req);
  if (!session) return unauthorizedResponse();

  // An empty body is allowed (recent sign-in); anything else must parse.
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch {
      return invalidInput();
    }
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return invalidInput();

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { passkeyCredentials: true },
  });
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 });

  if (!isRecentAuth(session.authenticatedAt)) {
    const { password } = parsed.data;
    if (!password) return reauthRequired();
    const limit = await checkAuthRateLimit('reauth', { ip: clientIp(req), email: user.email });
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    if (!user.password) {
      await burnPasswordCheck(password);
      return reauthRequired();
    }
    const reservation = await reservePasswordAttempt(user.id);
    if (!reservation.reserved || !(await verifyPassword(password, user.password))) {
      if (!reservation.reserved) await burnPasswordCheck(password);
      await recordAuthEvent({ event: 'LOGIN_FAILURE', req, userId: user.id, metadata: { reason: reservation.reserved ? 'wrong_password' : 'locked', stage: 'passkey_reauth' } });
      if (reservation.reserved && reservation.lockedNow) await recordAuthEvent({ event: 'ACCOUNT_LOCKED', req, userId: user.id });
      return reauthRequired();
    }
    await clearFailedAttempts(user.id);
  }

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

  return Response.json(options, { headers: noStoreHeaders() });
}
