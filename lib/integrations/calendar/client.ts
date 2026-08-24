import { google } from 'googleapis';
import type { CalendarCapability, CalendarEvent } from '../types';

export function createCalendarCapability(accessToken: string): CalendarCapability {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: 'v3', auth });

  return {
    async search({ from, to }): Promise<CalendarEvent[]> {
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      return (res.data.items ?? []).map((e) => ({
        id: e.id!,
        title: e.summary ?? '(no title)',
        start: new Date(e.start?.dateTime ?? e.start?.date!),
        end: new Date(e.end?.dateTime ?? e.end?.date!),
        location: e.location ?? undefined,
      }));
    },
  };
}
