// app/api/auth/github/callback/route.ts
// GitHub OAuth callback: state + PKCE checked, code exchanged, verified email
// selected from /user/emails (never /user's bare `email`), then the same
// find/link/create rules as Google (lib/auth/oauth-account). GitHub is
// identity-only; its access token is not stored.
import { exchangeGithubCode, fetchGithubUser, fetchGithubUserEmails, selectVerifiedEmail } from '@/lib/auth/github-oauth';
import { clearOAuthCookies, readOAuthCallback } from '@/lib/auth/oauth-flow';
import { resolveOAuthUser } from '@/lib/auth/oauth-account';
import { createSessionCookie } from '@/lib/auth/session';
import { recordAuthEvent } from '@/lib/audit/auth-events';
import { logger } from '@/lib/observability/logger';

async function fail(req: Request, status: number, error: string, reason: string, email?: string): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const c of clearOAuthCookies('github')) headers.append('Set-Cookie', c);
  await recordAuthEvent({ event: 'OAUTH_LOGIN_FAILURE', req, email, metadata: { provider: 'github', reason } });
  return Response.json({ error }, { status, headers });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return fail(req, 400, 'Missing code', 'missing_code');

  const flow = readOAuthCallback(req, 'github', state);
  if (!flow) {
    return fail(req, 400, 'Invalid OAuth state — possible CSRF, please try signing in again', 'state_mismatch');
  }

  let profile;
  let verifiedEmail: string | null;
  try {
    const accessToken = await exchangeGithubCode(code, flow.codeVerifier);
    profile = await fetchGithubUser(accessToken);
    // Must run, and reject on failure, before ANY user lookup/create/update.
    verifiedEmail = selectVerifiedEmail(await fetchGithubUserEmails(accessToken));
  } catch (error) {
    logger.warn('oauth.github.exchange_failed', { error });
    return fail(req, 400, 'GitHub sign-in failed, please try again', 'exchange_failed');
  }
  if (!verifiedEmail) {
    return fail(req, 400, 'GitHub account has no verified email address', 'no_verified_email');
  }

  const resolved = await resolveOAuthUser({
    field: 'githubId',
    providerId: String(profile.id),
    email: verifiedEmail,
    name: profile.name,
    image: profile.avatar_url,
  });
  if (!resolved.ok) {
    return fail(req, 409, 'An account for this GitHub identity already exists', 'conflict', verifiedEmail);
  }
  const { user } = resolved;

  if (resolved.outcome === 'linked') {
    await recordAuthEvent({
      event: 'OAUTH_LINKED',
      req,
      userId: user.id,
      email: user.email,
      metadata: { provider: 'github', droppedUnverifiedPassword: resolved.droppedPassword },
    });
  }
  await recordAuthEvent({
    event: 'OAUTH_LOGIN_SUCCESS',
    req,
    userId: user.id,
    email: user.email,
    metadata: { provider: 'github', outcome: resolved.outcome },
  });

  const headers = new Headers({ Location: '/today', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', await createSessionCookie(user));
  for (const c of clearOAuthCookies('github')) headers.append('Set-Cookie', c);
  return new Response(null, { status: 307, headers });
}
