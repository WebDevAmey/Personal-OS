import { describe, it, expect, vi } from 'vitest';
import { createGmailCapability } from './client';

const mockUsersGet = vi.fn();
const mockUsersList = vi.fn();
const mockDraftsCreate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: () => ({
      users: {
        messages: { list: mockUsersList, get: mockUsersGet },
        drafts: { create: mockDraftsCreate },
      },
    }),
    auth: { OAuth2: vi.fn().mockImplementation(function() { return { setCredentials: vi.fn() }; }) },
  },
}));

describe('createGmailCapability', () => {
  it('searches messages and maps them to EmailMessage', async () => {
    mockUsersList.mockResolvedValue({ data: { messages: [{ id: 'msg-1' }] } });
    mockUsersGet.mockResolvedValue({
      data: {
        id: 'msg-1',
        snippet: 'Hi, following up on the API access request...',
        internalDate: `${new Date('2026-08-24T09:00:00Z').getTime()}`,
        payload: { headers: [
          { name: 'From', value: 'recruiter@example.com' },
          { name: 'Subject', value: 'Following up' },
        ] },
      },
    });

    const gmail = createGmailCapability('fake-access-token');
    const results = await gmail.search('recruiter');

    expect(results).toEqual([{
      id: 'msg-1',
      from: 'recruiter@example.com',
      subject: 'Following up',
      snippet: 'Hi, following up on the API access request...',
      receivedAt: new Date('2026-08-24T09:00:00Z'),
    }]);
  });

  it('creates a draft via the Gmail API', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'draft-1' } });
    const gmail = createGmailCapability('fake-access-token');
    const result = await gmail.draft({ to: 'recruiter@example.com', subject: 'Re: Following up', body: 'Thanks for reaching out.' });
    expect(result).toEqual({ draftId: 'draft-1' });
  });
});
