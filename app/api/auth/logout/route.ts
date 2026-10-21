// app/api/auth/logout/route.ts
// Signs this browser out: clears the session cookie. Other devices stay
// signed in; use /api/auth/sessions/revoke-all for "sign out everywhere".
import { clearSessionCookie } from '@/lib/auth/cookies';
import { noStoreHeaders } from '@/lib/auth/http';
import { getSession } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/security/csrf';
import { recordAuthEvent } from '@/lib/audit/auth-events';

export async function POST(req: Request) {
  // Bodiless, so only the Origin check applies (no JSON requirement).
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  const session = await getSession(req);
  if (session) {
    await recordAuthEvent({ event: 'LOGOUT', req, userId: session.userId, metadata: { scope: 'this_device' } });
  }
  return Response.json({ message: 'Signed out' }, { headers: noStoreHeaders({ 'Set-Cookie': clearSessionCookie() }) });
}
