// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/lib/observability/logger';
import { IntegrationInputError, IntegrationScopeError, NeedsReconnectError, ProviderUnavailableError } from '../errors';
import { CALENDAR_READONLY_SCOPE } from '../google/scopes';
import { createCalendarCapability } from './client';

const mockEventsList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({ events: { list: mockEventsList } }),
    auth: { OAuth2: vi.fn(function () { return { setCredentials: vi.fn() }; }) },
  },
}));

const TOKEN = 'ya29.calendar-access-token-secret';
const quietLogger = createLogger({}, () => {});

beforeEach(() => {
  vi.clearAllMocks();
  mockEventsList.mockResolvedValue({ data: { items: [] } });
});

describe('listEvents', () => {
  it('queries the local-day range of the user time zone as UTC instants, read-only', async () => {
    const calendar = createCalendarCapability(TOKEN);
    const result = await calendar.listEvents({ timeZone: 'Asia/Kolkata', startDate: '2026-10-21', endDate: '2026-10-21' });

    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        timeMin: '2026-10-20T18:30:00.000Z',
        timeMax: '2026-10-21T18:30:00.000Z',
        timeZone: 'Asia/Kolkata',
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 30,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({ timeMin: '2026-10-20T18:30:00.000Z', timeMax: '2026-10-21T18:30:00.000Z', timeZone: 'Asia/Kolkata', events: [] });
  });

  it('converts a DST-boundary local day correctly (25-hour day in New York)', async () => {
    await createCalendarCapability(TOKEN).listEvents({ timeZone: 'America/New_York', startDate: '2026-11-01', endDate: '2026-11-01' });
    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({ timeMin: '2026-11-01T04:00:00.000Z', timeMax: '2026-11-02T05:00:00.000Z' }),
      expect.anything(),
    );
  });

  it('normalises timed and all-day events', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        timeZone: 'Asia/Kolkata',
        items: [
          {
            id: 'evt-1',
            summary: 'Review Figma prototype',
            start: { dateTime: '2026-10-21T15:00:00+05:30', timeZone: 'Asia/Kolkata' },
            end: { dateTime: '2026-10-21T15:30:00+05:30' },
            location: 'Zoom',
            attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }, { email: 'c@example.com' }],
          },
          { id: 'evt-2', summary: 'Conference', start: { date: '2026-10-21' }, end: { date: '2026-10-23' } },
        ],
      },
    });

    const { events } = await createCalendarCapability(TOKEN).listEvents({ timeZone: 'Asia/Kolkata', startDate: '2026-10-21', endDate: '2026-10-21' });

    expect(events).toEqual([
      {
        id: 'evt-1',
        title: 'Review Figma prototype',
        start: '2026-10-21T09:30:00.000Z',
        end: '2026-10-21T10:00:00.000Z',
        allDay: false,
        timeZone: 'Asia/Kolkata',
        location: 'Zoom',
        descriptionTruncated: false,
        attendeesCount: 3,
        status: 'confirmed',
        untrusted: true,
      },
      {
        id: 'evt-2',
        title: 'Conference',
        start: '2026-10-21',
        end: '2026-10-23',
        allDay: true,
        timeZone: 'Asia/Kolkata',
        descriptionTruncated: false,
        attendeesCount: 0,
        status: 'confirmed',
        untrusted: true,
      },
    ]);
  });

  it('exposes only the attendee count, never attendee identities', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [{ id: 'e', start: { dateTime: '2026-10-21T10:00:00Z' }, end: { dateTime: '2026-10-21T11:00:00Z' }, attendees: [{ email: 'secret@example.com', displayName: 'Secret' }] }] },
    });
    const { events } = await createCalendarCapability(TOKEN).listEvents({ timeZone: 'UTC', startDate: '2026-10-21', endDate: '2026-10-21' });
    expect(JSON.stringify(events)).not.toContain('secret@example.com');
    expect(events[0].attendeesCount).toBe(1);
  });

  it('truncates descriptions to 500 chars, strips HTML, and flags the event untrusted', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [
        { id: 'e1', summary: 'Sync', start: { dateTime: '2026-10-21T10:00:00Z' }, end: { dateTime: '2026-10-21T11:00:00Z' }, description: 'Agenda '.repeat(200) },
        { id: 'e2', summary: 'Call', start: { dateTime: '2026-10-21T12:00:00Z' }, end: { dateTime: '2026-10-21T13:00:00Z' }, description: '<p>Join <a href="https://x.test">here</a></p><script>evil()</script>' },
      ] },
    });
    const { events } = await createCalendarCapability(TOKEN).listEvents({ timeZone: 'UTC', startDate: '2026-10-21', endDate: '2026-10-21' });
    expect(events[0].description!.length).toBeLessThanOrEqual(500);
    expect(events[0].descriptionTruncated).toBe(true);
    expect(events[1].description).toBe('Join here');
    expect(events.every((e) => e.untrusted)).toBe(true);
  });

  it('skips cancelled events and defaults a missing title', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [
        { id: 'gone', status: 'cancelled', start: { dateTime: '2026-10-21T10:00:00Z' }, end: { dateTime: '2026-10-21T11:00:00Z' } },
        { id: 'e3', start: { dateTime: '2026-10-21T10:00:00Z' }, end: { dateTime: '2026-10-21T10:30:00Z' } },
      ] },
    });
    const { events } = await createCalendarCapability(TOKEN).listEvents({ timeZone: 'UTC', startDate: '2026-10-21', endDate: '2026-10-21' });
    expect(events.map((e) => [e.id, e.title])).toEqual([['e3', '(no title)']]);
  });

  it('caps results and reports truncation', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, start: { dateTime: '2026-10-21T10:00:00Z' }, end: { dateTime: '2026-10-21T11:00:00Z' } }));
    mockEventsList.mockResolvedValue({ data: { items, nextPageToken: 'more' } });
    const result = await createCalendarCapability(TOKEN).listEvents({ timeZone: 'UTC', startDate: '2026-10-21', endDate: '2026-10-21' }, { limit: 500 });
    expect(mockEventsList).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 50 }), expect.anything());
    expect(result.events).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it.each([
    ['invalid zone', { timeZone: 'Mars/Olympus', startDate: '2026-10-21', endDate: '2026-10-21' }],
    ['bad date', { timeZone: 'UTC', startDate: '2026-13-01', endDate: '2026-13-01' }],
    ['end before start', { timeZone: 'UTC', startDate: '2026-10-21', endDate: '2026-10-20' }],
    ['range over 31 days', { timeZone: 'UTC', startDate: '2026-01-01', endDate: '2026-03-01' }],
  ])('rejects %s before calling Google', async (_name, range) => {
    await expect(createCalendarCapability(TOKEN).listEvents(range)).rejects.toBeInstanceOf(IntegrationInputError);
    expect(mockEventsList).not.toHaveBeenCalled();
  });

  it('accepts a full 31-day local range spanning a DST change', async () => {
    await expect(createCalendarCapability(TOKEN).listEvents({ timeZone: 'America/New_York', startDate: '2026-10-15', endDate: '2026-11-14' })).resolves.toBeDefined();
  });

  it('maps 401 to NeedsReconnectError and 5xx to a retryable ProviderUnavailableError, without the token', async () => {
    const onNeedsReconnect = vi.fn();
    const calendar = createCalendarCapability(TOKEN, { userId: 'user-1', onNeedsReconnect, logger: quietLogger });
    const range = { timeZone: 'UTC', startDate: '2026-10-21', endDate: '2026-10-21' };

    mockEventsList.mockRejectedValueOnce(Object.assign(new Error(`401 Bearer ${TOKEN}`), { status: 401, config: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
    const e401 = await calendar.listEvents(range).catch((e: Error) => e);
    expect(e401).toBeInstanceOf(NeedsReconnectError);
    expect(onNeedsReconnect).toHaveBeenCalledWith('user-1');
    expect(JSON.stringify(e401) + (e401 as Error).message).not.toContain(TOKEN);

    mockEventsList.mockRejectedValueOnce(Object.assign(new Error('backend'), { response: { status: 502 } }));
    const e502 = await calendar.listEvents(range).catch((e: Error) => e);
    expect(e502).toBeInstanceOf(ProviderUnavailableError);
    expect((e502 as ProviderUnavailableError).retryable).toBe(true);
  });
});

describe('legacy search', () => {
  it('maps timed and all-day events to Date start/end', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [
        { id: 'evt-1', summary: 'Review', start: { dateTime: '2026-08-24T15:00:00Z' }, end: { dateTime: '2026-08-24T15:30:00Z' }, location: 'Zoom' },
        { id: 'evt-2', summary: 'All-day conference', start: { date: '2026-08-25' }, end: { date: '2026-08-26' } },
      ] },
    });
    const results = await createCalendarCapability(TOKEN).search({ from: new Date('2026-08-24T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') });
    expect(results).toEqual([
      { id: 'evt-1', title: 'Review', start: new Date('2026-08-24T15:00:00Z'), end: new Date('2026-08-24T15:30:00Z'), location: 'Zoom', allDay: false },
      { id: 'evt-2', title: 'All-day conference', start: new Date('2026-08-25'), end: new Date('2026-08-26'), location: undefined, allDay: true },
    ]);
  });
});

describe('read-only guarantees', () => {
  it('refuses to build a client for a grant with a calendar write scope', () => {
    expect(() => createCalendarCapability(TOKEN, { grantedScopes: `${CALENDAR_READONLY_SCOPE} https://www.googleapis.com/auth/calendar.events` }))
      .toThrow(IntegrationScopeError);
    expect(() => createCalendarCapability(TOKEN, { grantedScopes: 'https://www.googleapis.com/auth/gmail.readonly' })).toThrow(IntegrationScopeError);
    expect(() => createCalendarCapability(TOKEN, { grantedScopes: CALENDAR_READONLY_SCOPE })).not.toThrow();
  });

  it('no calendar module calls a write endpoint', () => {
    const dir = path.join(process.cwd(), 'lib/integrations/calendar');
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const file of sources) {
      const code = readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\.(insert|update|patch|delete|move|quickAdd|import|watch)\s*\(/);
      expect(code, file).not.toMatch(/\b(calendars|acl|settings|calendarList)\s*\./);
    }
  });
});
