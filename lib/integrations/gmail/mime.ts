// lib/integrations/gmail/mime.ts
//
// MIME helpers for Gmail: extracting a plain-text body from a message payload
// and building an RFC 5322 draft with header-injection protection.
import { z } from 'zod';
import { IntegrationInputError } from '../errors';
import { htmlToText, normaliseWhitespace } from '../text';

// ------------------------------------------------------------ extraction

export interface GmailPart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
}

/** Upper bound on encoded bytes decoded per part (bounded CPU/memory on huge mails). */
const MAX_ENCODED_PART = 512 * 1024;
const MAX_DEPTH = 10;

function headerValue(part: GmailPart, name: string): string {
  const lower = name.toLowerCase();
  return part.headers?.find((h) => h.name?.toLowerCase() === lower)?.value ?? '';
}

function isAttachment(part: GmailPart): boolean {
  if (part.filename) return true;
  if (part.body?.attachmentId && !part.body?.data) return true;
  return /^\s*attachment\b/i.test(headerValue(part, 'Content-Disposition'));
}

function charsetOf(part: GmailPart): string {
  const match = /charset\s*=\s*"?([A-Za-z0-9._:-]+)"?/i.exec(headerValue(part, 'Content-Type'));
  return match?.[1] ?? 'utf-8';
}

function decodePartData(part: GmailPart): string {
  let data = part.body?.data ?? '';
  if (!data) return '';
  if (data.length > MAX_ENCODED_PART) data = data.slice(0, MAX_ENCODED_PART - (MAX_ENCODED_PART % 4));
  const bytes = Buffer.from(data, 'base64url');
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetOf(part), { fatal: false });
  } catch {
    decoder = new TextDecoder('utf-8', { fatal: false });
  }
  return decoder.decode(bytes);
}

function findPart(part: GmailPart, mimeType: string, depth = 0): GmailPart | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const type = (part.mimeType ?? '').toLowerCase();
  if (type === mimeType && !isAttachment(part) && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Returns the message body as plain text: the first non-attachment
 * text/plain part, else the first text/html part converted to text, else ''.
 * Never returns markup.
 */
export function extractPlainTextBody(payload: GmailPart | null | undefined): { text: string; source: 'text/plain' | 'text/html' | 'none' } {
  if (!payload) return { text: '', source: 'none' };
  const plain = findPart(payload, 'text/plain');
  if (plain) return { text: normaliseWhitespace(decodePartData(plain)), source: 'text/plain' };
  const html = findPart(payload, 'text/html');
  if (html) return { text: htmlToText(decodePartData(html)), source: 'text/html' };
  return { text: '', source: 'none' };
}

// ------------------------------------------------------------- building

export const MAX_RECIPIENTS = 10;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_DRAFT_BODY_LENGTH = 5_000;

const emailSchema = z.email();
// RFC 5322 msg-id, restricted to a conservative character set.
const MESSAGE_ID = /^<[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,200}@[A-Za-z0-9.-]{1,200}>$/;
const HEADER_UNSAFE = /[\r\n\u0000\u2028\u2029\u0085]/;
const OTHER_CONTROLS = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Throws if `value` could break out of a header line. */
export function assertHeaderSafe(field: string, value: string): void {
  if (HEADER_UNSAFE.test(value)) throw new IntegrationInputError('gmail', field, 'line breaks are not allowed');
  if (OTHER_CONTROLS.test(value)) throw new IntegrationInputError('gmail', field, 'control characters are not allowed');
}

/** Validates and normalises recipients; plain `local@domain` addresses only. */
export function normaliseRecipients(to: string | string[]): string[] {
  const list = (Array.isArray(to) ? to : [to]).map((v) => {
    if (typeof v !== 'string') throw new IntegrationInputError('gmail', 'to', 'must be an email address');
    assertHeaderSafe('to', v);
    return v.trim();
  });
  if (list.length === 0) throw new IntegrationInputError('gmail', 'to', 'at least one recipient is required');
  if (list.length > MAX_RECIPIENTS) throw new IntegrationInputError('gmail', 'to', `at most ${MAX_RECIPIENTS} recipients`);
  for (const address of list) {
    if (address.length > 254 || !emailSchema.safeParse(address).success) {
      throw new IntegrationInputError('gmail', 'to', 'invalid email address');
    }
  }
  const seen = new Set<string>();
  return list.filter((a) => {
    const key = a.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isValidMessageId(value: string | null | undefined): value is string {
  return typeof value === 'string' && MESSAGE_ID.test(value.trim());
}

/**
 * RFC 2047 encodes a header value when it is not plain printable ASCII.
 * Splits into encoded-words of at most 75 chars without splitting a code
 * point, folded with CRLF + space.
 */
export function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const ch of value) {
    const next = chunk + ch;
    // 45 bytes of UTF-8 -> 60 base64 chars; with `=?UTF-8?B?` and `?=` = 72.
    if (Buffer.byteLength(next, 'utf8') > 45) {
      words.push(chunk);
      chunk = ch;
    } else {
      chunk = next;
    }
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

export interface DraftMessage {
  to: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
  messageIdHeader?: string;
}

/** Builds a base64url RFC 5322 message. All header values must already be validated. */
export function buildRawMessage(msg: DraftMessage): string {
  for (const address of msg.to) assertHeaderSafe('to', address);
  assertHeaderSafe('subject', msg.subject);
  const headers: string[] = [
    'MIME-Version: 1.0',
    `To: ${msg.to.join(', ')}`,
    `Subject: ${encodeHeaderValue(msg.subject)}`,
  ];
  if (msg.messageIdHeader) {
    if (!isValidMessageId(msg.messageIdHeader)) throw new IntegrationInputError('gmail', 'messageIdHeader', 'invalid Message-ID');
    headers.push(`Message-ID: ${msg.messageIdHeader}`);
  }
  if (msg.inReplyTo) {
    if (!isValidMessageId(msg.inReplyTo)) throw new IntegrationInputError('gmail', 'inReplyTo', 'invalid Message-ID');
    headers.push(`In-Reply-To: ${msg.inReplyTo}`);
  }
  const refs = (msg.references ?? []).filter(isValidMessageId);
  if (refs.length > 0) headers.push(`References: ${refs.join('\r\n ')}`);
  headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64');

  const body = msg.body.replace(/\r\n?|\n/g, '\r\n');
  const encodedBody = Buffer.from(body, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${encodedBody}`, 'utf8').toString('base64url');
}
