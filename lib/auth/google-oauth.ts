// lib/auth/google-oauth.ts
//
// Hand-rolled replacement for Auth.js's Google provider. Critically, this
// must keep requesting the same Gmail/Calendar API scopes the old Auth.js
// config did (see auth.ts) — the rest of this app's Gmail/Calendar
// integration depends on that scope bundling happening at sign-in, since
// there is no separate "connect Google" flow.
const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export function buildGoogleAuthUrl(state: string): string {
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
  return url.toString();
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token: string;
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status}`);
  }
  return res.json();
}

export interface GoogleIdTokenClaims {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export function decodeGoogleIdToken(idToken: string): GoogleIdTokenClaims {
  const payload = idToken.split('.')[1];
  const json = Buffer.from(payload, 'base64url').toString('utf-8');
  return JSON.parse(json);
}
