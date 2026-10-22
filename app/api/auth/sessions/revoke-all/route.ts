// app/api/auth/sessions/revoke-all/route.ts
// "Sign out everywhere": bumps User.sessionVersion, which invalidates every
// session token issued so far (getSession compares the version), and clears
// this browser's cookie as well.
import { prisma } from '@/lib/prisma';
import { clearSessionCookie } from '@/lib/auth/cookies';
import { noStoreHeaders } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/security/csrf';
import { recordAuthEvent } from '@/lib/audit/auth-events';

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  await prisma.user.update({ where: { id: auth.userId }, data: { sessionVersion: { increment: 1 } } });
  await recordAuthEvent({ event: 'SESSIONS_REVOKED', req, userId: auth.userId, metadata: { scope: 'all' } });
  return Response.json(
    { message: 'Signed out on all devices' },
    { headers: noStoreHeaders({ 'Set-Cookie': clearSessionCookie() }) },
  );
}
