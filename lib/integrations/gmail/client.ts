// lib/integrations/gmail/client.ts
//
// Gmail adapter. Read: bounded search and single-message fetch returning
// plain text flagged untrusted. Write: drafts.create only (gmail.compose);
// this module has no code path that sends mail, by design (ADR-011).
import { google } from 'googleapis';
import type { Logger } from '@/lib/observability/logger';
import { IntegrationInputError } from '../errors';
import { callGoogle, type GoogleCallContext } from '../google/api-call';
import { clip, decodeHtmlEntities, truncateText } from '../text';
import type { CreateDraftInput, CreatedDraft, EmailDetail, EmailMessage, GmailClient } from '../types';
import {
  MAX_DRAFT_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  assertHeaderSafe,
  buildRawMessage,
  extractPlainTextBody,
  isValidMessageId,
  normaliseRecipients,
  type GmailPart,
} from './mime';

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 25;
export const MAX_QUERY_LENGTH = 256;
export const MAX_BODY_CHARS = 8_000;
export const MAX_SNIPPET_CHARS = 300;
const MAX_HEADER_CHARS = 500;
const GMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_REFERENCES = 20;

export interface GmailClientOptions {
  timeoutMs?: number;
  userId?: string;
  onNeedsReconnect?: (userId: string) => void | Promise<void>;
  logger?: Logger;
}

type Headers = { name?: string | null; value?: string | null }[] | null | undefined;

function header(headers: Headers, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name?.toLowerCase() === lower)?.value ?? '';
}

function untrustedHeader(headers: Headers, name: string): string {
  return clip(header(headers, name).replace(/[\r\n]+/g, ' '), MAX_HEADER_CHARS);
}

function receivedAt(internalDate: string | null | undefined): Date {
  const ms = Number(internalDate);
  return Number.isFinite(ms) ? new Date(ms) : new Date(0);
}

export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

function assertMessageId(field: string, id: string): void {
  if (typeof id !== 'string' || !GMAIL_ID.test(id)) throw new IntegrationInputError('gmail', field, 'invalid message id');
}

export function createGmailCapability(accessToken: string, opts: GmailClientOptions = {}): GmailClient {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });
  const ctx: GoogleCallContext = { provider: 'gmail', ...opts };

  async function search(query: string, searchOpts: { limit?: number } = {}): Promise<EmailMessage[]> {
    const q = typeof query === 'string' ? query.trim() : '';
    if (q.length === 0) throw new IntegrationInputError('gmail', 'query', 'must not be empty');
    if (q.length > MAX_QUERY_LENGTH) throw new IntegrationInputError('gmail', 'query', `at most ${MAX_QUERY_LENGTH} characters`);
    const limit = clampLimit(searchOpts.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);

    const list = await callGoogle(ctx, 'messages.list', (o) =>
      gmail.users.messages.list({ userId: 'me', q, maxResults: limit }, o));
    const ids = (list.data.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && GMAIL_ID.test(id))
      .slice(0, limit);

    return Promise.all(ids.map(async (id) => {
      const msg = await callGoogle(ctx, 'messages.get', (o) =>
        gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }, o));
      const headers = msg.data.payload?.headers;
      return {
        id: msg.data.id ?? id,
        threadId: msg.data.threadId ?? undefined,
        from: untrustedHeader(headers, 'From'),
        subject: untrustedHeader(headers, 'Subject'),
        // Gmail snippets are HTML-entity encoded text.
        snippet: clip(decodeHtmlEntities(msg.data.snippet ?? ''), MAX_SNIPPET_CHARS),
        receivedAt: receivedAt(msg.data.internalDate),
        untrusted: true as const,
      };
    }));
  }

  async function get(messageId: string): Promise<EmailDetail> {
    assertMessageId('messageId', messageId);
    const msg = await callGoogle(ctx, 'messages.get', (o) =>
      gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' }, o));
    const payload = msg.data.payload as GmailPart | undefined;
    const headers = payload?.headers;
    const extracted = extractPlainTextBody(payload);
    const body = truncateText(extracted.text, MAX_BODY_CHARS);
    const rawMessageId = header(headers, 'Message-ID').trim();
    return {
      id: msg.data.id ?? messageId,
      threadId: msg.data.threadId ?? '',
      from: untrustedHeader(headers, 'From'),
      to: untrustedHeader(headers, 'To'),
      cc: untrustedHeader(headers, 'Cc'),
      subject: untrustedHeader(headers, 'Subject'),
      receivedAt: receivedAt(msg.data.internalDate),
      messageIdHeader: isValidMessageId(rawMessageId) ? rawMessageId : undefined,
      body: body.text,
      bodyTruncated: body.truncated,
      bodySource: extracted.source,
      untrusted: true,
    };
  }

  async function replyHeaders(inReplyToMessageId: string): Promise<{ threadId?: string; inReplyTo?: string; references: string[] }> {
    assertMessageId('inReplyToMessageId', inReplyToMessageId);
    const original = await callGoogle(ctx, 'messages.get', (o) =>
      gmail.users.messages.get({ userId: 'me', id: inReplyToMessageId, format: 'metadata', metadataHeaders: ['Message-ID', 'References'] }, o));
    const headers = original.data.payload?.headers;
    // Both headers are authored by the original sender: keep only
    // well-formed msg-ids so nothing they contain can reach our headers.
    const parentId = header(headers, 'Message-ID').trim();
    const inReplyTo = isValidMessageId(parentId) ? parentId : undefined;
    const references = (header(headers, 'References').match(/<[^<>\s]+>/g) ?? [])
      .filter(isValidMessageId)
      .slice(-(MAX_REFERENCES - 1));
    if (inReplyTo) references.push(inReplyTo);
    return { threadId: original.data.threadId ?? undefined, inReplyTo, references };
  }

  async function createDraft(input: CreateDraftInput): Promise<CreatedDraft> {
    const to = normaliseRecipients(input.to);
    if (typeof input.subject !== 'string') throw new IntegrationInputError('gmail', 'subject', 'required');
    assertHeaderSafe('subject', input.subject);
    const subject = input.subject.trim();
    if (subject.length > MAX_SUBJECT_LENGTH) throw new IntegrationInputError('gmail', 'subject', `at most ${MAX_SUBJECT_LENGTH} characters`);
    if (typeof input.body !== 'string' || input.body.trim().length === 0) throw new IntegrationInputError('gmail', 'body', 'must not be empty');
    if (input.body.length > MAX_DRAFT_BODY_LENGTH) throw new IntegrationInputError('gmail', 'body', `at most ${MAX_DRAFT_BODY_LENGTH} characters`);
    if (input.messageIdHeader !== undefined && !isValidMessageId(input.messageIdHeader)) {
      throw new IntegrationInputError('gmail', 'messageIdHeader', 'invalid Message-ID');
    }
    if (input.threadId !== undefined) assertMessageId('threadId', input.threadId);

    let threadId = input.threadId;
    let inReplyTo: string | undefined;
    let references: string[] = [];
    if (input.inReplyToMessageId !== undefined) {
      const reply = await replyHeaders(input.inReplyToMessageId);
      if (threadId && reply.threadId && threadId !== reply.threadId) {
        throw new IntegrationInputError('gmail', 'threadId', 'does not match the message being replied to');
      }
      threadId = threadId ?? reply.threadId;
      inReplyTo = reply.inReplyTo;
      references = reply.references;
    }

    const raw = buildRawMessage({ to, subject, body: input.body, inReplyTo, references, messageIdHeader: input.messageIdHeader });
    const res = await callGoogle(ctx, 'drafts.create', (o) =>
      gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } } }, o));
    if (!res.data.id) throw new IntegrationInputError('gmail', 'draft', 'Gmail returned no draft id');
    return {
      draftId: res.data.id,
      messageId: res.data.message?.id ?? undefined,
      threadId: res.data.message?.threadId ?? threadId,
    };
  }

  return {
    search,
    get,
    createDraft,

    /** Legacy shape: `get` reduced to the EmailMessage fields plus the plain-text body. */
    async read(id: string) {
      const detail = await get(id);
      return {
        id: detail.id,
        threadId: detail.threadId,
        from: detail.from,
        subject: detail.subject,
        snippet: clip(detail.body, MAX_SNIPPET_CHARS),
        receivedAt: detail.receivedAt,
        body: detail.body,
        untrusted: true as const,
      };
    },

    /** Legacy shape for `createDraft`. */
    async draft({ to, subject, body }) {
      const { draftId } = await createDraft({ to, subject, body });
      return { draftId };
    },
  };
}
