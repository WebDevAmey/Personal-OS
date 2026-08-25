// app/api/auth/google/callback/route.ts
import { exchangeGoogleCode, decodeGoogleIdToken, SCOPES } from '@/lib/auth/google-oauth';
import { prisma } from '@/lib/prisma';
import { signSessionToken } from '@/lib/auth/jwt';
import { readCookie } from '@/lib/auth/cookies';

// Duck-typed rather than `instanceof Prisma.PrismaClientKnownRequestError`:
// the generated client's error class doesn't survive test mocking cleanly
// (a mocked reject value is a plain object, not a real instance), and the
// `code` field is the only part of the shape this route actually depends on.
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return Response.json({ error: 'Missing code' }, { status: 400 });

  // CSRF check: the state cookie was set by app/api/auth/google/route.ts
  // right before redirecting to Google, and must come back unchanged as the
  // callback's ?state= param. Both values are required and must match —
  // there is no fallback path that lets a missing cookie or a missing/blank
  // query param slip through, since either one being falsy would make an
  // attacker-forged callback (no cookie of their own, or a guessed/omitted
  // state) indistinguishable from a legitimate one.
  const cookieState = readCookie(req, 'google_oauth_state');
  if (!cookieState || !state || cookieState !== state) {
    return Response.json({ error: 'Invalid OAuth state — possible CSRF, please try signing in again' }, { status: 400 });
  }

  const tokens = await exchangeGoogleCode(code);
  const claims = decodeGoogleIdToken(tokens.id_token);

  // Google will complete this flow for an account whose email was never
  // actually verified (email_verified: false), e.g. one the attacker signed
  // up with `victim@example.com` and never confirmed. Trusting that email
  // for account lookup below would link the attacker's Google sign-in to
  // the victim's existing account — full session takeover. This check must
  // run before ANY prisma.user lookup/create/update.
  if (claims.email_verified !== true) {
    return Response.json({ error: 'Google account email is not verified' }, { status: 400 });
  }

  if (!claims.sub || !claims.email) {
    return Response.json({ error: 'Google did not return the required profile fields' }, { status: 400 });
  }

  // Look up by googleId FIRST. A user's Google account email can change
  // after their first sign-in here (e.g. they move to a new address at
  // Google); if we only ever looked up by email, that person would come
  // back through the CREATE branch below with their (unchanged) googleId,
  // collide with their own existing row's unique googleId constraint, and
  // be permanently locked out. googleId is the stable identifier for "same
  // Google account", so it takes priority over email.
  let user = await prisma.user.findUnique({ where: { googleId: claims.sub } });

  if (!user) {
    // Not found by googleId — fall back to linking/creating by email, so an
    // existing password-created account gets *linked* rather than shadowed
    // by a second, duplicate row for the same person.
    user = await prisma.user.findUnique({ where: { email: claims.email } });
    if (!user) {
      try {
        user = await prisma.user.create({
          data: { email: claims.email, googleId: claims.sub, name: claims.name, image: claims.picture, emailVerified: true },
        });
      } catch (error) {
        // A racing request (or a stale googleId collision we didn't catch
        // above) can still trip the unique constraint on email or googleId
        // here. Surface a clean error instead of an unhandled 500.
        if (isUniqueConstraintError(error)) {
          return Response.json({ error: 'An account for this Google identity already exists' }, { status: 409 });
        }
        throw error;
      }
    } else if (!user.googleId) {
      // Not reassigning `user` from the result here is deliberate: this update
      // only ever touches `googleId`, so the `id`/`sessionVersion` already in
      // hand from the lookup above stay correct for everything used below.
      await prisma.user.update({ where: { id: user.id }, data: { googleId: claims.sub } });
    }
  }

  await prisma.integrationAccount.upsert({
    where: { userId_provider: { userId: user.id, provider: 'google' } },
    create: {
      userId: user.id, provider: 'google', accessToken: tokens.access_token,
      // Google lets users decline individual scopes at the consent screen,
      // so what we actually got back can be a strict subset of SCOPES —
      // record that, not what was merely requested. Fall back to SCOPES
      // only if Google's response omits `scope` entirely.
      refreshToken: tokens.refresh_token, scopes: tokens.scope ?? SCOPES,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
    update: {
      accessToken: tokens.access_token,
      // Google only sends a refresh_token when it issues a new one (e.g.
      // first-ever consent, or a forced `prompt=consent` re-consent) — an
      // unconditional overwrite here would wipe out a still-valid refresh
      // token on every subsequent sign-in that doesn't get a new one.
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      scopes: tokens.scope ?? SCOPES,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  const sessionToken = await signSessionToken({ userId: user.id, sessionVersion: user.sessionVersion });
  const isProd = process.env.NODE_ENV === 'production';
  const sessionCookie = `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;
  // Clear the one-time state cookie now that it's served its purpose —
  // otherwise it sits valid (and reusable, if somehow recaptured) for the
  // rest of its 5-minute Max-Age. A Response can only take one `Set-Cookie`
  // via the `headers: {...}` object shorthand (later keys overwrite
  // earlier ones), so both cookies are appended individually here.
  const clearStateCookie = 'google_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  const headers = new Headers({ Location: '/today' });
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', clearStateCookie);

  return new Response(null, { status: 307, headers });
}
