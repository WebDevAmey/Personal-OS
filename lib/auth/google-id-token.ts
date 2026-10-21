// lib/auth/google-id-token.ts
// Verifies a Google ID token's signature against Google's published JWKS and
// checks iss, aud and exp (SEC-B-021, T-OAUTH-04). The token arrives straight
// from Google's token endpoint over TLS, so this is defence in depth, but it
// means a forged or replayed token for another client is never trusted.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

export interface GoogleIdTokenClaims {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  // Google's proof that `email` was verified as belonging to this account.
  // Callers MUST reject unverified emails before any account lookup or link.
  email_verified?: boolean;
}

let remoteJwks: JWTVerifyGetKey | null = null;

function googleJwks(): JWTVerifyGetKey {
  // jose caches keys and refetches on an unknown `kid`, with a cooldown.
  remoteJwks ??= createRemoteJWKSet(GOOGLE_JWKS_URL, { timeoutDuration: 10_000 });
  return remoteJwks;
}

export async function verifyGoogleIdToken(
  idToken: string,
  { keys = googleJwks(), audience = process.env.GOOGLE_CLIENT_ID }: { keys?: JWTVerifyGetKey; audience?: string } = {},
): Promise<GoogleIdTokenClaims> {
  if (!audience) throw new Error('GOOGLE_CLIENT_ID must be set');
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: GOOGLE_ISSUERS,
    audience,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('Google ID token is missing sub or email');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    email_verified: payload.email_verified === true,
  };
}
