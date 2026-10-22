// app/(app)/_lib/data.ts — server-side reads shared by the app pages. Every
// read is scoped to the signed-in user and goes through the repositories
// (ADR-006); pages never import Prisma.
import { cache } from 'react';
import { requirePageUser } from '@/lib/auth/session';
import { getPreferences } from '@/lib/preferences/repo';
import { listProjects } from '@/lib/projects/repo';
import { getAccountProfile } from '@/lib/account/repo';
import { clockFor, toProjectDTO, type Clock } from '@/app/api/tasks/_lib/serialize';
import { listView } from '@/app/api/tasks/_lib/service';
import { toPreferencesDTO } from '@/app/api/tasks/_lib/settings';

/** One lookup per request, shared by the layout and the page. */
export const pageUser = cache(async () => {
  const session = await requirePageUser();
  const prefs = await getPreferences(session.userId);
  const clock: Clock = clockFor(prefs.timeZone);
  return { userId: session.userId, prefs, preferences: toPreferencesDTO(prefs), clock };
});

export const shellData = cache(async () => {
  const { userId, preferences, clock } = await pageUser();
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
