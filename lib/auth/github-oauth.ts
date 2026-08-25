// lib/auth/github-oauth.ts
//
// Hand-rolled GitHub OAuth, identity-only (no API scope bundling like the
// Google flow — see lib/auth/google-oauth.ts — since nothing in this app
// calls the GitHub API on the user's behalf beyond initial sign-in).
//
// GitHub's OAuth flow does not return an ID token the way Google's does, so
// there is no signed claim to trust for "this email was verified as
// belonging to this account." The /user endpoint's bare `email` field can
// even be null (private email setting) and, when non-null, carries no
// verification signal at all. The only trustworthy source is the
// /user/emails endpoint (requires the user:email scope, requested below),
// which returns each address's verified/primary status explicitly.
// Callers MUST use selectVerifiedEmail() below for account lookup/linking —
// never /user's `email` field directly — or an attacker who controls an
// unverified "victim@example.com" GitHub email could get linked into the
// victim's existing account.

export function buildGithubAuthUrl(state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID!);
  url.searchParams.set('redirect_uri', `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/github/callback`);
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGithubCode(code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/github/callback`,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`);
  }
  const data = await res.json();
  // A missing/malformed access_token here must fail loudly rather than
  // letting `undefined` flow into the Authorization header of the next
  // fetch call (which would silently produce an unauthenticated request
  // instead of a clear error).
  if (typeof data?.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('GitHub token exchange response missing access_token');
  }
  return data.access_token;
}

export interface GithubUser {
  id: number;
  // Nullable: GitHub returns null here when the user has set their email to
  // private in account settings. Never used directly for account lookup —
  // see fetchGithubUserEmails/selectVerifiedEmail below.
  email: string | null;
  name?: string;
  avatar_url?: string;
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub user fetch failed: ${res.status}`);
  }
  const data = await res.json();
  if (typeof data?.id !== 'number') {
    throw new Error('GitHub user response missing id');
  }
  return data;
}

export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export async function fetchGithubUserEmails(accessToken: string): Promise<GithubEmail[]> {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub email fetch failed: ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('GitHub email response was not an array');
  }
  return data;
}

// Selects the single email address this app is willing to trust for account
// lookup/linking/creation. Prefers the entry marked both primary and
// verified (the normal case); falls back to the first verified-but-not-
// primary entry only for the edge case where GitHub hasn't marked any
// verified address as primary. Returns null — never an unverified or null
// email — when no verified address exists at all; callers must reject the
// sign-in in that case rather than proceeding.
export function selectVerifiedEmail(emails: GithubEmail[]): string | null {
  const primaryVerified = emails.find((e) => e.primary === true && e.verified === true);
  if (primaryVerified) return primaryVerified.email;
  const anyVerified = emails.find((e) => e.verified === true);
  return anyVerified ? anyVerified.email : null;
}
