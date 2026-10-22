// lib/auth/oauth-flow.ts
// Shared OAuth plumbing for the Google and GitHub flows: `state` (CSRF on the
// callback) and PKCE S256 (code interception), both kept in short-lived
// HttpOnly cookies that the callback clears.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildCookie, clearCookie, readAuthCookie } from './cookies';

export type OAuthProvider = 'google' | 'github';

const FLOW_MAX_AGE_SECONDS = 5 * 60;

export function stateCookieBase(provider: OAuthProvider): string {
  return `${provider}_oauth_state`;
}

export function pkceCookieBase(provider: OAuthProvider): string {
  return `${provider}_oauth_pkce`;
}

export interface OAuthStart {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  cookies: string[];
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function startOAuthFlow(provider: OAuthProvider): OAuthStart {
  const state = randomBytes(16).toString('hex');
  // 32 random bytes → 43 base64url chars, within RFC 7636's 43–128 range.
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    state,
    codeVerifier,
    codeChallenge: pkceChallenge(codeVerifier),
    cookies: [
      buildCookie(stateCookieBase(provider), state, { maxAgeSeconds: FLOW_MAX_AGE_SECONDS }),
      buildCookie(pkceCookieBase(provider), codeVerifier, { maxAgeSeconds: FLOW_MAX_AGE_SECONDS }),
    ],
  };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Checks the callback's `state` against the cookie and returns the PKCE
 * verifier, or null when either is missing or the state does not match.
 */
export function readOAuthCallback(req: Request, provider: OAuthProvider, state: string | null): { codeVerifier: string } | null {
  const cookieState = readAuthCookie(req, stateCookieBase(provider));
  const codeVerifier = readAuthCookie(req, pkceCookieBase(provider));
  if (!cookieState || !state || !codeVerifier) return null;
  if (!safeEqual(cookieState, state)) return null;
  return { codeVerifier };
}

export function clearOAuthCookies(provider: OAuthProvider): string[] {
  return [clearCookie(stateCookieBase(provider)), clearCookie(pkceCookieBase(provider))];
}
