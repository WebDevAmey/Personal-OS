// lib/integrations/calendar/client.ts
//
// Read-only Google Calendar adapter (calendar.readonly, ADR-011). The only
// Google endpoint this module calls is events.list; it never calls insert,
// update, patch, delete, move, quickAdd or import.
import { google, type calendar_v3 } from 'googleapis';
import type { Logger } from '@/lib/observability/logger';
import { IntegrationInputError } from '../errors';
import { callGoogle, type GoogleCallContext } from '../google/api-call';
import { assertCalendarReadonlyScopes } from '../google/scopes';
import { clip, htmlToText, truncateText } from '../text';
import type {
  CalendarClient,
  CalendarEvent,
  InstantRange,
  ListEventsOptions,
  ListEventsResult,
  LocalDateRange,
  NormalizedEvent,
} from '../types';
import { addDays, isValidTimeZone, localDateRangeToUtc, parseLocalDate } from './time-zone';

export const MAX_RANGE_DAYS = 31;
export const DEFAULT_EVENT_LIMIT = 30;
export const MAX_EVENT_LIMIT = 50;
export const MAX_DESCRIPTION_CHARS = 500;
export const MAX_EVENT_QUERY_LENGTH = 100;
const MAX_TITLE_CHARS = 300;
const MAX_LOCATION_CHARS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CalendarClientOptions {
  /**
   * Scopes recorded on the IntegrationAccount. When given, the client
   * refuses to run unless they are exactly read-only for Calendar.
   */
  grantedScopes?: string;
  timeoutMs?: number;
  userId?: string;
  onNeedsReconnect?: (userId: string) => void | Promise<void>;
  logger?: Logger;
}

function isLocalRange(range: LocalDateRange | InstantRange): range is LocalDateRange {
  return 'startDate' in range;
}

function resolveRange(range: LocalDateRange | InstantRange): { timeMin: Date; timeMax: Date; timeZone: string } {
  if (!range || typeof range.timeZone !== 'string' || !isValidTimeZone(range.timeZone)) {
    throw new IntegrationInputError('calendar', 'timeZone', 'must be a valid IANA time zone');
  }
  let timeMin: Date;
  let timeMax: Date;
  if (isLocalRange(range)) {
    if (!parseLocalDate(range.startDate)) throw new IntegrationInputError('calendar', 'startDate', 'must be YYYY-MM-DD');
    if (!parseLocalDate(range.endDate)) throw new IntegrationInputError('calendar', 'endDate', 'must be YYYY-MM-DD');
    if (range.endDate < range.startDate) throw new IntegrationInputError('calendar', 'endDate', 'must not be before startDate');
    ({ timeMin, timeMax } = localDateRangeToUtc(range.startDate, range.endDate, range.timeZone));
  } else {
    timeMin = range.timeMin;
    timeMax = range.timeMax;
    if (!(timeMin instanceof Date) || Number.isNaN(timeMin.getTime())) throw new IntegrationInputError('calendar', 'timeMin', 'invalid date');
    if (!(timeMax instanceof Date) || Number.isNaN(timeMax.getTime())) throw new IntegrationInputError('calendar', 'timeMax', 'invalid date');
    if (timeMax <= timeMin) throw new IntegrationInputError('calendar', 'timeMax', 'must be after timeMin');
  }
  // +1h tolerance so a 31-local-day range that spans a DST change passes.
  if (timeMax.getTime() - timeMin.getTime() > MAX_RANGE_DAYS * DAY_MS + 60 * 60 * 1000) {
    throw new IntegrationInputError('calendar', 'range', `at most ${MAX_RANGE_DAYS} days`);
  }
  return { timeMin, timeMax, timeZone: range.timeZone };
}

/** Calendar descriptions may be HTML; always reduce to text. */
function descriptionText(raw: string): string {
  return /<[a-z!/]/i.test(raw) ? htmlToText(raw) : raw.trim();
}

export function normalizeEvent(e: calendar_v3.Schema$Event, fallbackTimeZone: string): NormalizedEvent | null {
  if (!e.id || e.status === 'cancelled') return null;
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  let start: string;
  let end: string;
  if (allDay) {
    start = e.start!.date!;
    // Google's all-day end date is exclusive; a missing end means one day.
    if (!parseLocalDate(start)) return null;
    end = e.end?.date && parseLocalDate(e.end.date) ? e.end.date : addDays(start, 1);
  } else {
    const s = new Date(e.start?.dateTime ?? '');
    const en = new Date(e.end?.dateTime ?? e.start?.dateTime ?? '');
    if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime())) return null;
    start = s.toISOString();
    end = en.toISOString();
  }
  const eventZone = e.start?.timeZone && isValidTimeZone(e.start.timeZone) ? e.start.timeZone : fallbackTimeZone;
  const description = e.description ? truncateText(descriptionText(e.description), MAX_DESCRIPTION_CHARS) : undefined;
  return {
    id: e.id,
    title: clip((e.summary ?? '').trim() || '(no title)', MAX_TITLE_CHARS),
    start,
    end,
    allDay,
    timeZone: eventZone,
    ...(e.location ? { location: clip(e.location, MAX_LOCATION_CHARS) } : {}),
    ...(description && description.text ? { description: description.text } : {}),
    descriptionTruncated: description?.truncated ?? false,
    attendeesCount: Array.isArray(e.attendees) ? e.attendees.length : 0,
    status: e.status === 'tentative' ? 'tentative' : 'confirmed',
    untrusted: true,
  };
}

export function createCalendarCapability(accessToken: string, opts: CalendarClientOptions = {}): CalendarClient {
  if (opts.grantedScopes !== undefined) assertCalendarReadonlyScopes(opts.grantedScopes);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: 'v3', auth });
  const ctx: GoogleCallContext = { provider: 'calendar', ...opts };

  async function listEvents(range: LocalDateRange | InstantRange, listOpts: ListEventsOptions = {}): Promise<ListEventsResult> {
    const { timeMin, timeMax, timeZone } = resolveRange(range);
    let q: string | undefined;
    if (listOpts.query !== undefined) {
      q = String(listOpts.query).trim();
      if (q.length > MAX_EVENT_QUERY_LENGTH) throw new IntegrationInputError('calendar', 'query', `at most ${MAX_EVENT_QUERY_LENGTH} characters`);
      if (q.length === 0) q = undefined;
    }
    const limit = listOpts.limit === undefined || !Number.isFinite(listOpts.limit)
      ? DEFAULT_EVENT_LIMIT
      : Math.min(MAX_EVENT_LIMIT, Math.max(1, Math.floor(listOpts.limit)));

    const res = await callGoogle(ctx, 'events.list', (o) =>
      calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: limit,
        ...(q ? { q } : {}),
      }, o));

    const calendarZone = res.data.timeZone && isValidTimeZone(res.data.timeZone) ? res.data.timeZone : timeZone;
    const items = res.data.items ?? [];
    const events = items
      .map((e) => normalizeEvent(e, calendarZone))
      .filter((e): e is NormalizedEvent => e !== null)
      .slice(0, limit);
    return {
      events,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone,
      truncated: Boolean(res.data.nextPageToken) || items.length > limit,
    };
  }

  return {
    listEvents,

    /** Legacy shape: instant range in UTC, Date start/end. */
    async search({ from, to }): Promise<CalendarEvent[]> {
      const { events } = await listEvents({ timeZone: 'UTC', timeMin: from, timeMax: to });
      return events.map((e) => ({
        id: e.id,
        title: e.title,
        start: new Date(e.start),
        end: new Date(e.end),
        location: e.location,
        allDay: e.allDay,
      }));
    },
  };
}
