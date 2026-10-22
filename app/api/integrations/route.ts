// GET /api/integrations — connection status of each integration (Google only in V1)
import { json, route } from '@/app/api/tasks/_lib/http';
import { googleIntegrationStatus } from './_status';

export async function GET(req: Request) {
  return route(req, {}, async ({ userId }) => json({ integrations: [await googleIntegrationStatus(userId)] }));
}
