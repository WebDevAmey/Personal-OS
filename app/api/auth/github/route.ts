// app/api/auth/github/route.ts
// Starts GitHub sign-in with `state` + PKCE S256 (see lib/auth/oauth-flow.ts).
import { buildGithubAuthUrl } from '@/lib/auth/github-oauth';
import { startOAuthFlow } from '@/lib/auth/oauth-flow';
import { checkAuthRateLimit, rateLimitedResponse } from '@/lib/security/auth-rate-limit';
import { clientIp } from '@/lib/security/request-meta';

export async function GET(req: Request) {
  const limit = await checkAuthRateLimit('oauth', { ip: clientIp(req) });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  const flow = startOAuthFlow('github');
  const headers = new Headers({ Location: buildGithubAuthUrl(flow.state, flow.codeChallenge), 'Cache-Control': 'no-store' });
  for (const cookie of flow.cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 307, headers });
}
