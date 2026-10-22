// GET   /api/preferences
// PATCH /api/preferences { ...fields }  — validated twice: Zod here, then the repo's own rules
import { getPreferences, updatePreferences } from '@/lib/preferences/repo';
import { json, route } from '@/app/api/tasks/_lib/http';
import { PreferencesPatchSchema, toPreferencesDTO } from '@/app/api/tasks/_lib/settings';

export async function GET(req: Request) {
  return route(req, {}, async ({ userId }) => json({ preferences: toPreferencesDTO(await getPreferences(userId)) }));
}

export async function PATCH(req: Request) {
  return route(req, { body: PreferencesPatchSchema }, async ({ userId, body, requestId }) =>
    json({ preferences: toPreferencesDTO(await updatePreferences(userId, body, { requestId })) }),
  );
}
