// POST /api/briefing/today/refresh — regenerate today's briefing into the
// same run (FR-310). Same-origin JSON only; at most once per 30 min per user,
// never while a run is pending/running, never for a fresh successful briefing.
import { requireUser } from '@/lib/auth/session';
import { csrfGuard } from '@/lib/security/csrf';
import { requestBriefingRefresh } from '@/lib/briefing/today';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: Request): Promise<Response> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const header = req.headers.get('x-request-id');
  const requestId = header && /^[A-Za-z0-9_.:-]{1,100}$/.test(header) ? header : undefined;
  const result = await requestBriefingRefresh(auth.userId, new Date(), requestId);
  switch (result.outcome) {
    case 'queued':
      return Response.json({ status: 'queued' }, { status: 202, headers: NO_STORE });
    case 'running':
      return Response.json({ error: 'A briefing is already being prepared', code: 'BRIEFING_RUNNING' }, { status: 409, headers: NO_STORE });
    case 'fresh':
      return Response.json({ error: "Today's briefing is up to date", code: 'BRIEFING_FRESH' }, { status: 409, headers: NO_STORE });
    case 'exhausted':
      return Response.json({ error: 'No more refreshes today', code: 'BRIEFING_RETRIES_EXHAUSTED' }, { status: 429, headers: NO_STORE });
    case 'rate_limited':
      return Response.json(
        { error: 'Try again later', code: 'RATE_LIMITED', retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { ...NO_STORE, 'Retry-After': String(result.retryAfterSeconds) } },
      );
  }
}
