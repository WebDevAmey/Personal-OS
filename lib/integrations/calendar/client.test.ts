import { describe, it, expect, vi } from 'vitest';
import { createCalendarCapability } from './client';

const mockEventsList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({ events: { list: mockEventsList } }),
    auth: { OAuth2: vi.fn(function() { return { setCredentials: vi.fn() }; }) },
  },
}));

describe('createCalendarCapability', () => {
  it('maps Google Calendar events into CalendarEvent for a date range', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [{
        id: 'evt-1',
        summary: 'Review Figma prototype',
        start: { dateTime: '2026-08-24T15:00:00Z' },
        end: { dateTime: '2026-08-24T15:30:00Z' },
        location: 'Zoom',
      }] },
    });

    const calendar = createCalendarCapability('fake-access-token');
    const results = await calendar.search({ from: new Date('2026-08-24T00:00:00Z'), to: new Date('2026-08-25T00:00:00Z') });

    expect(results).toEqual([{
      id: 'evt-1',
      title: 'Review Figma prototype',
      start: new Date('2026-08-24T15:00:00Z'),
      end: new Date('2026-08-24T15:30:00Z'),
      location: 'Zoom',
    }]);
  });

  it('handles all-day events using date field instead of dateTime', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [{
        id: 'evt-2',
        summary: 'All-day conference',
        start: { date: '2026-08-25' },
        end: { date: '2026-08-26' },
      }] },
    });

    const calendar = createCalendarCapability('fake-access-token');
    const results = await calendar.search({ from: new Date('2026-08-25T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') });

    expect(results).toEqual([{
      id: 'evt-2',
      title: 'All-day conference',
      start: new Date('2026-08-25'),
      end: new Date('2026-08-26'),
      location: undefined,
    }]);
  });

  it('handles missing fields with defaults', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [{
        id: 'evt-3',
        start: { dateTime: '2026-08-24T10:00:00Z' },
        end: { dateTime: '2026-08-24T10:30:00Z' },
      }] },
    });

    const calendar = createCalendarCapability('fake-access-token');
    const results = await calendar.search({ from: new Date('2026-08-24T00:00:00Z'), to: new Date('2026-08-25T00:00:00Z') });

    expect(results).toEqual([{
      id: 'evt-3',
      title: '(no title)',
      start: new Date('2026-08-24T10:00:00Z'),
      end: new Date('2026-08-24T10:30:00Z'),
      location: undefined,
    }]);
  });
});
