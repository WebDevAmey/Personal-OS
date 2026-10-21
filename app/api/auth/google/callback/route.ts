// app/api/auth/google/callback/route.ts
// Google OAuth callback (docs/02 §3.2):
//   state cookie == ?state (constant time) → code exchange with the PKCE
//   verifier → ID token verified against Google's JWKS (iss, aud, exp) →
//   email_verified required → find/link/create user (lib/auth/oauth-account)
//   → Gmail/Calendar tokens stored ENCRYPTED (ADR-011, SEC-B-017) → fresh
//   session cookie, flow cookies cleared, 307 to /today.
import { exchangeGoogleCode, SCOPES, verifyGoogleIdToken, type GoogleIdTokenClaims } from '@/lib/auth/google-oauth';
import { clearOAuthCookies, readOAuthCallback } from '@/lib/auth/oauth-flow';
import { resolveOAuthUser } from '@/lib/auth/oauth-account';
import { createSessionCookie } from '@/lib/auth/session';
import { encryptToken } from '@/lib/security/token-crypto';
import { prisma } from '@/lib/prisma';
import { recordAuthEvent } from '@/lib/audit/auth-events';
import { logger } from '@/lib/observability/logger';

async function fail(req: Request, status: number, error: string, reason: string, email?: string): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const c of clearOAuthCookies('google')) headers.append('Set-Cookie', c);
  await recordAuthEvent({ event: 'OAUTH_LOGIN_FAILURE', req, email, metadata: { provider: 'google', reason } });
  return Response.json({ error }, { status, headers });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return fail(req, 400, 'Missing code', 'missing_code');

  // Both the state cookie and ?state are required and must match; the PKCE
  // verifier cookie must be present too.
  const flow = readOAuthCallback(req, 'google', state);
  if (!flow) {
    return fail(req, 400, 'Invalid OAuth state — possible CSRF, please try signing in again', 'state_mismatch');
  }

  let tokens;
  let claims: GoogleIdTokenClaims;
  try {
    tokens = await exchangeGoogleCode(code, flow.codeVerifier);
    claims = await verifyGoogleIdToken(tokens.id_token);
  } catch (error) {
    logger.warn('oauth.google.exchange_failed', { error });
    return fail(req, 400, 'Google sign-in failed, please try again', 'exchange_or_id_token');
  }

  // Must run before ANY user lookup/create/update: an unverified Google email
  // could otherwise be linked into someone else's account.
  if (claims.email_verified !== true) {
    return fail(req, 400, 'Google account email is not verified', 'email_not_verified');
  }
  if (!claims.sub || !claims.email) {
    return fail(req, 400, 'Google did not return the required profile fields', 'missing_claims');
  }

  const resolved = await resolveOAuthUser({
    field: 'googleId',
    providerId: claims.sub,
    email: claims.email,
    name: claims.name,
    image: claims.picture,
  });
  if (!resolved.ok) {
    return fail(req, 409, 'An account for this Google identity already exists', 'conflict', claims.email);
  }
  const { user } = resolved;

  // ADR-011: tokens are sealed before they touch the database. Decryption
  // lives in lib/integrations/google/refresh-token.ts (WS-3).
  const scopes = tokens.scope ?? SCOPES;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const accessToken = encryptToken(tokens.access_token);
  const refreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined;
  await prisma.integrationAccount.upsert({
    where: { userId_provider: { userId: user.id, provider: 'google' } },
    // Google lets users decline individual scopes, so the granted list is
    // stored, falling back to what was requested only if `scope` is omitted.
    create: { userId: user.id, provider: 'google', accessToken, refreshToken, scopes, expiresAt },
    update: {
      accessToken,
      // Google only sends a refresh_token when it issues a new one; keep the
      // stored one otherwise.
      ...(refreshToken ? { refreshToken } : {}),
      scopes,
      expiresAt,
    },
  });

  if (resolved.outcome === 'linked') {
    await recordAuthEvent({
      event: 'OAUTH_LINKED',
      req,
      userId: user.id,
      email: user.email,
      metadata: { provider: 'google', droppedUnverifiedPassword: resolved.droppedPassword },
    });
  }
  await recordAuthEvent({
    event: 'OAUTH_LOGIN_SUCCESS',
    req,
    userId: user.id,
    email: user.email,
    metadata: { provider: 'google', outcome: resolved.outcome },
  });

  const headers = new Headers({ Location: '/today', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', await createSessionCookie(user));
  for (const c of clearOAuthCookies('google')) headers.append('Set-Cookie', c);
  return new Response(null, { status: 307, headers });
}
