// GET /api/briefing/today — today's stored briefing for the signed-in user
// (lib/briefing/today.ts shape). Read-only: no model call, no enqueue.
import { requireUser } from '@/lib/auth/session';
import { getTodayBriefing } from '@/lib/briefing/today';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const result = await getTodayBriefing(auth.userId);
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}
