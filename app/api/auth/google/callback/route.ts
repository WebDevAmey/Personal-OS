// app/api/auth/google/callback/route.ts
import { exchangeGoogleCode, decodeGoogleIdToken } from '@/lib/auth/google-oauth';
import { prisma } from '@/lib/prisma';
import { signSessionToken } from '@/lib/auth/jwt';
import { readCookie } from '@/lib/auth/cookies';

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
  if (!claims.sub || !claims.email) {
    return Response.json({ error: 'Google did not return the required profile fields' }, { status: 400 });
  }

  // Look up by email first (never by googleId), so an existing
  // password-created account gets *linked* rather than shadowed by a second,
  // duplicate row for the same person.
  let user = await prisma.user.findUnique({ where: { email: claims.email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: claims.email, googleId: claims.sub, name: claims.name, image: claims.picture, emailVerified: true },
    });
  } else if (!user.googleId) {
    // Not reassigning `user` from the result here is deliberate: this update
    // only ever touches `googleId`, so the `id`/`sessionVersion` already in
    // hand from the lookup above stay correct for everything used below.
    await prisma.user.update({ where: { id: user.id }, data: { googleId: claims.sub } });
  }

  await prisma.integrationAccount.upsert({
    where: { userId_provider: { userId: user.id, provider: 'google' } },
    create: {
      userId: user.id, provider: 'google', accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token, scopes: 'gmail.readonly gmail.compose calendar.readonly',
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
    update: {
      accessToken: tokens.access_token,
      // Google only sends a refresh_token when it issues a new one (e.g.
      // first-ever consent, or a forced `prompt=consent` re-consent) — an
      // unconditional overwrite here would wipe out a still-valid refresh
      // token on every subsequent sign-in that doesn't get a new one.
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  const sessionToken = await signSessionToken({ userId: user.id, sessionVersion: user.sessionVersion });
  const isProd = process.env.NODE_ENV === 'production';
  const cookie = `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;

  return new Response(null, { status: 307, headers: { Location: '/today', 'Set-Cookie': cookie } });
}
