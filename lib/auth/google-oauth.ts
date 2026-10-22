// lib/auth/google-oauth.ts
//
// Hand-rolled replacement for Auth.js's Google provider. Critically, this
// must keep requesting the same Gmail/Calendar API scopes the old Auth.js
// config did (see auth.ts) — the rest of this app's Gmail/Calendar
// integration depends on that scope bundling happening at sign-in, since
// there is no separate "connect Google" flow.
//
// Exported so the callback route can fall back to "what we asked for" when
// Google's token response omits `scope` (see GoogleTokenResponse below) —
// that only happens on a token refresh, never on the initial exchange this
// callback handles, but the fallback keeps the two in sync by construction
// rather than by a second hand-maintained literal.
export const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export function buildGoogleAuthUrl(state: string, codeChallenge: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  // offline + consent: without both, Google only returns a refresh_token on
  // the very first consent ever granted by that user for this client. Since
  // getFreshAccessToken (lib/integrations/google/refresh-token.ts) depends on
  // always having a refresh_token to fall back on, every sign-in must force
  // a fresh consent screen that reliably issues one.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  // PKCE S256 (RFC 7636): the callback must present the matching verifier.
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token: string;
  // Space-delimited list of scopes Google actually granted, which can be a
  // strict subset of what was requested if the user declined some at the
  // consent screen. Optional because Google omits it in some responses
  // (callers should fall back to the requested SCOPES string, not assume
  // "everything was granted").
  scope?: string;
}

export async function exchangeGoogleCode(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status}`);
  }
  const data = await res.json();
  if (typeof data?.access_token !== 'string' || typeof data?.id_token !== 'string') {
    throw new Error('Google token exchange response missing access_token or id_token');
  }
  return data;
}

// ID-token verification (signature via Google's JWKS, iss, aud, exp) lives
// in ./google-id-token.ts.
export { verifyGoogleIdToken, type GoogleIdTokenClaims } from './google-id-token';
