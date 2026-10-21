// app/api/auth/google/route.ts
// Starts Google sign-in: `state` and a PKCE verifier go into 5-minute
// HttpOnly cookies (see lib/auth/oauth-flow.ts) and the browser is sent to
// Google with the matching state and S256 code challenge.
import { buildGoogleAuthUrl } from '@/lib/auth/google-oauth';
import { startOAuthFlow } from '@/lib/auth/oauth-flow';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';

export async function GET(req: Request) {
  const limit = await checkAuthRateLimit('oauth', { ip: clientIp(req) });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  const flow = startOAuthFlow('google');
  const headers = new Headers({ Location: buildGoogleAuthUrl(flow.state, flow.codeChallenge), 'Cache-Control': 'no-store' });
  for (const cookie of flow.cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 307, headers });
}
