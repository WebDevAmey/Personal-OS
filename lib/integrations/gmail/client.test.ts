// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/lib/observability/logger';
import { IntegrationInputError, NeedsReconnectError, ProviderUnavailableError } from '../errors';
import { createGmailCapability } from './client';

const mockMessagesList = vi.fn();
const mockMessagesGet = vi.fn();
const mockDraftsCreate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: () => ({
      users: {
        messages: { list: mockMessagesList, get: mockMessagesGet },
        drafts: { create: mockDraftsCreate },
      },
    }),
    auth: { OAuth2: vi.fn().mockImplementation(function () { return { setCredentials: vi.fn() }; }) },
  },
}));

const TOKEN = 'ya29.gmail-access-token-secret';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function decodeRaw(raw: string): { headers: string; body: string } {
  const message = Buffer.from(raw, 'base64url').toString('utf8');
  const split = message.indexOf('\r\n\r\n');
  const headers = message.slice(0, split);
  const body = Buffer.from(message.slice(split + 4).replace(/\r\n/g, ''), 'base64').toString('utf8');
  return { headers, body };
}

function gaxiosError(status: number) {
  return Object.assign(new Error(`Request failed ${status} Bearer ${TOKEN}`), {
    status,
    config: { headers: { Authorization: `Bearer ${TOKEN}` } },
    response: { status, headers: {} },
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('search', () => {
  const metadata = (id: string) => ({
    data: {
      id,
      threadId: `t-${id}`,
      snippet: 'Hi, following up on the API access request&#39;s status &amp; timeline',
      internalDate: `${new Date('2026-08-24T09:00:00Z').getTime()}`,
      payload: { headers: [{ name: 'From', value: 'recruiter@example.com' }, { name: 'Subject', value: 'Following up' }] },
    },
  });

  it('maps results, decodes snippet entities and flags them untrusted', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'msg1' }] } });
    mockMessagesGet.mockResolvedValue(metadata('msg1'));

    const results = await createGmailCapability(TOKEN).search('recruiter');

    expect(results).toEqual([{
      id: 'msg1',
      threadId: 't-msg1',
      from: 'recruiter@example.com',
      subject: 'Following up',
      snippet: "Hi, following up on the API access request's status & timeline",
      receivedAt: new Date('2026-08-24T09:00:00Z'),
      untrusted: true,
    }]);
    expect(mockMessagesList).toHaveBeenCalledWith(
      { userId: 'me', q: 'recruiter', maxResults: 10 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockMessagesGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg1', format: 'metadata' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('defaults to 10 results and caps at 25 even if Gmail returns more', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}` }));
    mockMessagesList.mockResolvedValue({ data: { messages: many } });
    mockMessagesGet.mockImplementation(async ({ id }: { id: string }) => metadata(id));
    const gmail = createGmailCapability(TOKEN);

    expect(await gmail.search('x')).toHaveLength(10);
    expect(await gmail.search('x', { limit: 100 })).toHaveLength(25);
    expect(mockMessagesList).toHaveBeenLastCalledWith(expect.objectContaining({ maxResults: 25 }), expect.anything());
    expect(await gmail.search('x', { limit: 0 })).toHaveLength(1);
  });

  it('rejects empty and over-long queries before calling Gmail', async () => {
    const gmail = createGmailCapability(TOKEN);
    await expect(gmail.search('   ')).rejects.toBeInstanceOf(IntegrationInputError);
    await expect(gmail.search('a'.repeat(257))).rejects.toBeInstanceOf(IntegrationInputError);
    expect(mockMessagesList).not.toHaveBeenCalled();
  });

  it('truncates attacker-controlled headers and snippets', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'm1' }] } });
    mockMessagesGet.mockResolvedValue({
      data: { id: 'm1', snippet: 's'.repeat(1000), internalDate: '0', payload: { headers: [{ name: 'Subject', value: 'S'.repeat(5000) }] } },
    });
    const [msg] = await createGmailCapability(TOKEN).search('x');
    expect(msg.subject.length).toBeLessThanOrEqual(500);
    expect(msg.snippet.length).toBeLessThanOrEqual(300);
  });

  it('maps 401 to NeedsReconnectError, calls onNeedsReconnect, and never exposes the token', async () => {
    mockMessagesList.mockRejectedValue(gaxiosError(401));
    const lines: string[] = [];
    const onNeedsReconnect = vi.fn();
    const gmail = createGmailCapability(TOKEN, { userId: 'user-1', onNeedsReconnect, logger: createLogger({}, (l) => lines.push(l)) });

    const err = await gmail.search('x').catch((e: Error) => e);
    expect(err).toBeInstanceOf(NeedsReconnectError);
    expect(onNeedsReconnect).toHaveBeenCalledWith('user-1');
    const text = [(err as Error).message, String((err as Error).cause ?? ''), JSON.stringify(err), ...lines].join('\n');
    expect(text).not.toContain(TOKEN);
  });

  it('maps 5xx to a retryable ProviderUnavailableError', async () => {
    mockMessagesList.mockRejectedValue(gaxiosError(503));
    const err = await createGmailCapability(TOKEN, { logger: createLogger({}, () => {}) }).search('x').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as ProviderUnavailableError).retryable).toBe(true);
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe('get', () => {
  const full = (payload: unknown) => ({
    data: {
      id: 'm1',
      threadId: 't1',
      internalDate: `${new Date('2026-08-24T09:00:00Z').getTime()}`,
      payload,
    },
  });
  const headers = [
    { name: 'From', value: 'Priya <priya@example.com>' },
    { name: 'To', value: 'me@example.com' },
    { name: 'Subject', value: 'Plan' },
    { name: 'Message-ID', value: '<abc123@mail.example.com>' },
  ];

  it('prefers the text/plain part of a multipart/alternative message', async () => {
    mockMessagesGet.mockResolvedValue(full({
      mimeType: 'multipart/alternative',
      headers,
      parts: [
        { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: b64('Plain body \u2014 caf\u00E9') } },
        { mimeType: 'text/html', body: { data: b64('<p>HTML body</p>') } },
      ],
    }));

    const msg = await createGmailCapability(TOKEN).get('m1');
    expect(msg).toMatchObject({
      id: 'm1',
      threadId: 't1',
      from: 'Priya <priya@example.com>',
      to: 'me@example.com',
      subject: 'Plan',
      messageIdHeader: '<abc123@mail.example.com>',
      body: 'Plain body \u2014 caf\u00E9',
      bodySource: 'text/plain',
      bodyTruncated: false,
      untrusted: true,
    });
    expect(mockMessagesGet).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', format: 'full' }), expect.anything());
  });

  it('falls back to HTML converted to text, never returning markup', async () => {
    mockMessagesGet.mockResolvedValue(full({
      mimeType: 'multipart/mixed',
      headers,
      parts: [
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<html><style>x{}</style><body><p>Hello <b>there</b></p><script>steal()</script><img src=x onerror=alert(1)></body></html>') } }] },
        { mimeType: 'text/plain', filename: 'notes.txt', body: { attachmentId: 'att1' } },
      ],
    }));

    const msg = await createGmailCapability(TOKEN).get('m1');
    expect(msg.body).toBe('Hello there');
    expect(msg.bodySource).toBe('text/html');
    expect(msg.body).not.toMatch(/[<>]|steal|onerror/);
  });

  it('decodes a non-UTF-8 charset', async () => {
    mockMessagesGet.mockResolvedValue(full({
      mimeType: 'text/plain',
      headers: [...headers, { name: 'Content-Type', value: 'text/plain; charset="iso-8859-1"' }],
      body: { data: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64url') },
    }));
    expect((await createGmailCapability(TOKEN).get('m1')).body).toBe('caf\u00E9');
  });

  it('truncates the body to 8,000 characters and flags it', async () => {
    mockMessagesGet.mockResolvedValue(full({ mimeType: 'text/plain', headers, body: { data: b64('x'.repeat(20_000)) } }));
    const msg = await createGmailCapability(TOKEN).get('m1');
    expect(msg.body.length).toBeLessThanOrEqual(8_000);
    expect(msg.bodyTruncated).toBe(true);
  });

  it('drops a malformed Message-ID header', async () => {
    mockMessagesGet.mockResolvedValue(full({ mimeType: 'text/plain', headers: [{ name: 'Message-ID', value: '<x@y>\r\nBcc: evil@attacker.test' }], body: { data: b64('hi') } }));
    expect((await createGmailCapability(TOKEN).get('m1')).messageIdHeader).toBeUndefined();
  });

  it('rejects malformed message ids before calling Gmail', async () => {
    await expect(createGmailCapability(TOKEN).get('../../etc')).rejects.toBeInstanceOf(IntegrationInputError);
    expect(mockMessagesGet).not.toHaveBeenCalled();
  });

  it('legacy read() returns the plain-text body', async () => {
    mockMessagesGet.mockResolvedValue(full({ mimeType: 'text/plain', headers, body: { data: b64('Full body text') } }));
    const msg = await createGmailCapability(TOKEN).read('m1');
    expect(msg.body).toBe('Full body text');
    expect(msg.subject).toBe('Plan');
  });
});

describe('createDraft', () => {
  beforeEach(() => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'draft-1', message: { id: 'dm1', threadId: 't1' } } });
  });

  it('creates a draft with a correctly encoded RFC 5322 message', async () => {
    const result = await createGmailCapability(TOKEN).createDraft({
      to: 'recruiter@example.com',
      subject: 'Re: Following up',
      body: 'Thanks for reaching out.\nTalk soon.',
    });
    expect(result).toEqual({ draftId: 'draft-1', messageId: 'dm1', threadId: 't1' });

    const [params, opts] = mockDraftsCreate.mock.calls[0];
    expect(params.userId).toBe('me');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    const { headers, body } = decodeRaw(params.requestBody.message.raw);
    expect(headers.split('\r\n')).toEqual([
      'MIME-Version: 1.0',
      'To: recruiter@example.com',
      'Subject: Re: Following up',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ]);
    expect(body).toBe('Thanks for reaching out.\r\nTalk soon.');
  });

  it('RFC 2047-encodes a non-ASCII subject', async () => {
    await createGmailCapability(TOKEN).createDraft({ to: 'a@example.com', subject: 'Caf\u00E9 \u2615 plans', body: 'x' });
    const { headers } = decodeRaw(mockDraftsCreate.mock.calls[0][0].requestBody.message.raw);
    const subject = /Subject: (.*)/.exec(headers)![1];
    expect(subject).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(Buffer.from(subject.slice(10, -2), 'base64').toString('utf8')).toBe('Caf\u00E9 \u2615 plans');
  });

  it.each([
    ['CRLF in subject', { to: 'a@example.com', subject: 'Hi\r\nBcc: evil@attacker.test', body: 'x' }],
    ['LF in subject', { to: 'a@example.com', subject: 'Hi\nBcc: evil@attacker.test', body: 'x' }],
    ['CR in subject', { to: 'a@example.com', subject: 'Hi\rBcc: evil@attacker.test', body: 'x' }],
    ['CRLF in to', { to: 'a@example.com\r\nBcc: evil@attacker.test', subject: 'Hi', body: 'x' }],
    ['LF in one of several recipients', { to: ['a@example.com', 'b@example.com\nCc: evil@attacker.test'], subject: 'Hi', body: 'x' }],
    ['unicode line separator in subject', { to: 'a@example.com', subject: 'Hi\u2028Bcc: evil@attacker.test', body: 'x' }],
  ])('rejects header injection: %s', async (_name, input) => {
    await expect(createGmailCapability(TOKEN).createDraft(input)).rejects.toBeInstanceOf(IntegrationInputError);
    expect(mockDraftsCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['display name', 'Priya <priya@example.com>'],
    ['comma list', 'a@example.com, evil@attacker.test'],
    ['no domain', 'priya'],
    ['empty', ''],
  ])('rejects invalid recipient: %s', async (_name, to) => {
    await expect(createGmailCapability(TOKEN).createDraft({ to, subject: 'Hi', body: 'x' })).rejects.toBeInstanceOf(IntegrationInputError);
    expect(mockDraftsCreate).not.toHaveBeenCalled();
  });

  it('caps recipients, subject and body length', async () => {
    const gmail = createGmailCapability(TOKEN);
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`);
    await expect(gmail.createDraft({ to: eleven, subject: 'Hi', body: 'x' })).rejects.toBeInstanceOf(IntegrationInputError);
    await expect(gmail.createDraft({ to: 'a@example.com', subject: 's'.repeat(201), body: 'x' })).rejects.toBeInstanceOf(IntegrationInputError);
    await expect(gmail.createDraft({ to: 'a@example.com', subject: 'Hi', body: 'b'.repeat(5001) })).rejects.toBeInstanceOf(IntegrationInputError);
    await expect(gmail.createDraft({ to: 'a@example.com', subject: 'Hi', body: '  ' })).rejects.toBeInstanceOf(IntegrationInputError);
    expect(mockDraftsCreate).not.toHaveBeenCalled();
  });

  it('threads a reply: In-Reply-To, References and threadId from the original message', async () => {
    mockMessagesGet.mockResolvedValue({
      data: {
        id: 'orig1',
        threadId: 'thread-9',
        payload: { headers: [
          { name: 'Message-ID', value: '<orig@mail.example.com>' },
          { name: 'References', value: '<root@mail.example.com> <bad\r\nBcc: x@y> <mid@mail.example.com>' },
        ] },
      },
    });

    await createGmailCapability(TOKEN).createDraft({
      to: 'priya@example.com',
      subject: 'Re: Plan',
      body: 'Sounds good.',
      inReplyToMessageId: 'orig1',
      messageIdHeader: '<proposal-123@personal-os.app>',
    });

    const params = mockDraftsCreate.mock.calls[0][0];
    expect(params.requestBody.message.threadId).toBe('thread-9');
    const { headers } = decodeRaw(params.requestBody.message.raw);
    expect(headers).toContain('Message-ID: <proposal-123@personal-os.app>');
    expect(headers).toContain('In-Reply-To: <orig@mail.example.com>');
    expect(headers).toContain('References: <root@mail.example.com>\r\n <mid@mail.example.com>\r\n <orig@mail.example.com>');
    expect(headers).not.toMatch(/Bcc/i);
  });

  it('rejects a threadId that does not match the replied-to message', async () => {
    mockMessagesGet.mockResolvedValue({ data: { id: 'orig1', threadId: 'thread-9', payload: { headers: [] } } });
    await expect(createGmailCapability(TOKEN).createDraft({ to: 'a@example.com', subject: 'Re', body: 'x', inReplyToMessageId: 'orig1', threadId: 'other' }))
      .rejects.toBeInstanceOf(IntegrationInputError);
    expect(mockDraftsCreate).not.toHaveBeenCalled();
  });

  it('rejects a malformed caller-supplied Message-ID', async () => {
    await expect(createGmailCapability(TOKEN).createDraft({ to: 'a@example.com', subject: 'Hi', body: 'x', messageIdHeader: '<a@b>\r\nBcc: c@d' }))
      .rejects.toBeInstanceOf(IntegrationInputError);
  });

  it('legacy draft() delegates to createDraft with the same validation', async () => {
    const gmail = createGmailCapability(TOKEN);
    await expect(gmail.draft({ to: 'recruiter@example.com', subject: 'Re: Following up', body: 'Thanks.' })).resolves.toEqual({ draftId: 'draft-1' });
    await expect(gmail.draft({ to: 'a@example.com', subject: 'x\r\nBcc: e@f.test', body: 'y' })).rejects.toBeInstanceOf(IntegrationInputError);
  });
});

describe('never sends mail', () => {
  it('the capability exposes no send method', () => {
    const gmail = createGmailCapability(TOKEN) as unknown as Record<string, unknown>;
    expect(Object.keys(gmail).sort()).toEqual(['createDraft', 'draft', 'get', 'read', 'search']);
  });

  it('no Gmail module calls messages.send, drafts.send or any .send(', () => {
    const dir = path.join(process.cwd(), 'lib/integrations/gmail');
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const code = readFileSync(path.join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\bmessages\s*\.\s*send\b/);
      expect(code, file).not.toMatch(/\bdrafts\s*\.\s*send\b/);
      expect(code, file).not.toMatch(/\.\s*send\s*\(/);
      expect(code, file).not.toMatch(/['"]send['"]/);
      expect(code, file).not.toMatch(/gmail\.send|mail\.google\.com/);
    }
  });
});
