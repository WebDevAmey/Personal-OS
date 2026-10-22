// app/(app)/_lib/data.ts — server-side reads shared by the app pages. Every
// page and layout authenticates itself with requirePageUser() (layouts do not
// re-run on client navigation, so a layout check alone is not enough); these
// loaders take the authenticated userId and are cached per request.
// All reads go through the repositories (ADR-006); pages never import Prisma.
import { cache } from 'react';
import { getPreferences } from '@/lib/preferences/repo';
import { listProjects } from '@/lib/projects/repo';
import { getAccountProfile } from '@/lib/account/repo';
import { clockFor, toProjectDTO, type Clock } from '@/app/api/tasks/_lib/serialize';
import { listView } from '@/app/api/tasks/_lib/service';
import { toPreferencesDTO } from '@/app/api/tasks/_lib/settings';

/** Preferences and the user's clock, once per request. */
export const userContext = cache(async (userId: string) => {
  const prefs = await getPreferences(userId);
  const clock: Clock = clockFor(prefs.timeZone);
  return { userId, prefs, preferences: toPreferencesDTO(prefs), clock };
});

export const shellData = cache(async (userId: string) => {
  const { preferences, clock } = await userContext(userId);
  const [projects, profile, today, inbox] = await Promise.all([
    listProjects(userId),
    getAccountProfile(userId),
    listView(userId, { view: 'today', limit: 200 }, clock),
    listView(userId, { view: 'inbox', limit: 200 }, clock),
  ]);
  const open = today.items.filter((i) => i.task.status !== 'DONE' && i.task.status !== 'CANCELLED');
  return {
    session: {
      today: clock.today,
      timeZone: clock.timeZone,
      locale: preferences.locale,
      projects: projects.map(toProjectDTO),
      speechOutputEnabled: preferences.speechOutputEnabled,
      reducedMotion: preferences.reducedMotion,
      email: profile?.email ?? '',
    },
    displayName: profile?.name ?? null,
    counts: {
      today: open.filter((i) => i.task.isDueToday && !i.task.isOverdue).length,
      overdue: open.filter((i) => i.task.isOverdue).length,
      inbox: inbox.items.length,
    },
  };
});
