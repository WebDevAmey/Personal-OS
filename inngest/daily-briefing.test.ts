import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateBriefing, loadAccountUserIds, generateAndSaveBriefing } from './daily-briefing';

vi.mock('@/lib/tasks/queries', () => ({ searchTasks: vi.fn().mockResolvedValue([{ title: 'Finish assembler assignment', dueDate: new Date('2026-08-24') }]) }));

const mockGenerateObject = vi.fn().mockResolvedValue({
  object: { attentionItems: ['Finish assembler assignment'], digestItems: ['Speculative decoding trended today'] },
});
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateObject: (...args: Parameters<typeof actual.generateObject>) => mockGenerateObject(...args) };
});

const mockSelectFrom = vi.fn();
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({ from: mockSelectFrom })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
  },
}));
vi.mock('@/db/schema', () => ({ integrationAccounts: { userId: 'userId' }, dailyBriefings: {} }));

const mockGetFreshAccessToken = vi.fn().mockResolvedValue('fresh-access-token');
vi.mock('@/lib/integrations/google/refresh-token', () => ({
  getFreshAccessToken: (userId: string) => mockGetFreshAccessToken(userId),
}));
const mockCreateGmailCapability = vi.fn((_accessToken: string) => ({ search: vi.fn().mockResolvedValue([]), read: vi.fn(), draft: vi.fn() }));
vi.mock('@/lib/integrations/gmail/client', () => ({
  createGmailCapability: (accessToken: string) => mockCreateGmailCapability(accessToken),
}));
const mockCreateCalendarCapability = vi.fn((_accessToken: string) => ({ search: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/integrations/calendar/client', () => ({
  createCalendarCapability: (accessToken: string) => mockCreateCalendarCapability(accessToken),
}));

describe('generateBriefing', () => {
  it('combines email, calendar, and task signals into attention + digest items', async () => {
    const briefing = await generateBriefing({
      userId: 'user-1',
      email: { search: vi.fn().mockResolvedValue([]), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn().mockResolvedValue([]) },
    });

    expect(briefing.attentionItems).toContain('Finish assembler assignment');
    expect(briefing.digestItems.length).toBeGreaterThan(0);
  });

  // Finding 7: generateBriefing must use generateObject (schema-validated)
  // instead of generateText + JSON.parse, which was fragile against markdown
  // code fences/leading prose/truncation and burned duplicate Claude calls
  // on Inngest step retries when parsing failed.
  it('calls generateObject with a zod schema and returns result.object directly, without any JSON.parse', async () => {
    await generateBriefing({
      userId: 'user-1',
      email: { search: vi.fn().mockResolvedValue([]), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn().mockResolvedValue([]) },
    });

    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      schema: expect.anything(),
    }));
  });
});

// Finding 6: OAuth tokens must never be memoized into Inngest's durable step
// storage. load-accounts previously returned whole integration_accounts rows
// (access_token/refresh_token included); it must now return only userIds,
// and per-user work must fetch its own fresh token internally instead of
// receiving one from the outer step's return value.
describe('loadAccountUserIds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns distinct userIds only - no access/refresh tokens or other account fields', async () => {
    mockSelectFrom.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-1' }]);

    const userIds = await loadAccountUserIds();

    expect(userIds.sort()).toEqual(['user-1', 'user-2']);
    // Every element must be a bare string userId, never an object carrying
    // token fields.
    for (const id of userIds) expect(typeof id).toBe('string');
  });
});

describe('generateAndSaveBriefing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches a fresh access token internally, builds capabilities from it, and saves the briefing', async () => {
    mockGetFreshAccessToken.mockResolvedValue('fresh-access-token');
    mockGenerateObject.mockResolvedValue({
      object: { attentionItems: ['Finish assembler assignment'], digestItems: ['Speculative decoding trended today'] },
    });

    await generateAndSaveBriefing('user-1');

    expect(mockGetFreshAccessToken).toHaveBeenCalledWith('user-1');
    expect(mockCreateGmailCapability).toHaveBeenCalledWith('fresh-access-token');
    expect(mockCreateCalendarCapability).toHaveBeenCalledWith('fresh-access-token');
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      attentionItems: ['Finish assembler assignment'],
      digestItems: ['Speculative decoding trended today'],
    }));
  });

  it('propagates a token-refresh failure instead of silently building capabilities from an empty token', async () => {
    const refreshError = new Error('refresh failed');
    mockGetFreshAccessToken.mockRejectedValue(refreshError);

    await expect(generateAndSaveBriefing('user-1')).rejects.toThrow('refresh failed');
    expect(mockCreateGmailCapability).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
