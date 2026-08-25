// app/api/auth/google/route.ts
import { buildGoogleAuthUrl } from '@/lib/auth/google-oauth';
import { randomBytes } from 'node:crypto';

export async function GET() {
  const state = randomBytes(16).toString('hex');
  const url = buildGoogleAuthUrl(state);
  // The state cookie is compared against the callback's ?state= param
  // (see app/api/auth/google/callback/route.ts) to prevent CSRF — an
  // attacker tricking a victim into completing OAuth with the attacker's
  // own authorization code. 5-minute expiry is enough for a normal consent
  // flow; httpOnly since JS never needs to read it. Secure in production,
  // matching the session cookie (app/api/auth/login/route.ts) — without it
  // this cookie could travel over plaintext HTTP and be captured by a
  // network attacker to pull off that same CSRF.
  const isProd = process.env.NODE_ENV === 'production';
  const stateCookie = `google_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300${isProd ? '; Secure' : ''}`;
  return new Response(null, { status: 307, headers: { Location: url, 'Set-Cookie': stateCookie } });
}
