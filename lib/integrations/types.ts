// lib/integrations/types.ts
//
// Shapes returned by the integration adapters. Every field that a third
// party can author (sender, subject, body, event title, description,
// location, web content) is untrusted: results carry `untrusted: true` and
// must go through `wrapUntrusted` (lib/integrations/untrusted.ts) before they
// reach model context.
//
// `EmailCapability`, `CalendarCapability` and `WebCapability` keep their
// original method names (`search`/`read`/`draft`) so existing callers keep
// compiling; the richer methods (`get`, `createDraft`, `listEvents`) are the
// ones new tool code should use.

/** Marker on any result containing third-party-authored text. */
export interface UntrustedContent {
  untrusted: true;
}

// ---------------------------------------------------------------- email

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  threadId?: string;
  untrusted?: true;
}

export interface EmailSearchOptions {
  /** Default 10, clamped to 1..25. */
  limit?: number;
}

export interface EmailDetail extends UntrustedContent {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  receivedAt: Date;
  /** RFC 5322 Message-ID header of the message, if well-formed. */
  messageIdHeader?: string;
  /** Plain text only (text/plain preferred; HTML converted to text). Never markup. */
  body: string;
  bodyTruncated: boolean;
  bodySource: 'text/plain' | 'text/html' | 'none';
}

export interface CreateDraftInput {
  /** One address or up to 10; plain addresses only, no display names. */
  to: string | string[];
  subject: string;
  body: string;
  /** Gmail API id of the message being replied to; sets In-Reply-To/References and the thread. */
  inReplyToMessageId?: string;
  threadId?: string;
  /** Deterministic Message-ID, e.g. `<proposalId@personal-os.app>`, for retry lookup. */
  messageIdHeader?: string;
}

export interface CreatedDraft {
  draftId: string;
  messageId?: string;
  threadId?: string;
}

export interface EmailCapability {
  search(query: string, opts?: EmailSearchOptions): Promise<EmailMessage[]>;
  read(id: string): Promise<EmailMessage & { body: string }>;
  draft(input: { to: string; subject: string; body: string }): Promise<{ draftId: string }>;
}

export interface GmailClient extends EmailCapability {
  get(messageId: string): Promise<EmailDetail>;
  /** Creates a Gmail draft. There is no send method, by design. */
  createDraft(input: CreateDraftInput): Promise<CreatedDraft>;
}

// ------------------------------------------------------------- calendar

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location?: string;
  allDay?: boolean;
}

/** A range of whole local days in `timeZone`, `endDate` inclusive. */
export interface LocalDateRange {
  timeZone: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, inclusive. */
  endDate: string;
}

/** An instant range, with the zone used to interpret and label events. */
export interface InstantRange {
  timeZone: string;
  timeMin: Date;
  timeMax: Date;
}

export interface ListEventsOptions {
  /** Free-text filter passed to Google (`q`), at most 100 chars. */
  query?: string;
  /** Default 30, clamped to 1..50. */
  limit?: number;
}

export interface NormalizedEvent extends UntrustedContent {
  id: string;
  title: string;
  /** All-day: `YYYY-MM-DD`. Timed: UTC ISO-8601 instant. */
  start: string;
  /** All-day: `YYYY-MM-DD`, exclusive (as Google reports it). Timed: UTC ISO-8601 instant. */
  end: string;
  allDay: boolean;
  /** Zone the event is anchored to (event's own zone, else calendar's, else the request's). */
  timeZone: string;
  location?: string;
  description?: string;
  descriptionTruncated: boolean;
  attendeesCount: number;
  status: 'confirmed' | 'tentative';
}

export interface ListEventsResult {
  events: NormalizedEvent[];
  /** The UTC instants actually queried. */
  timeMin: string;
  timeMax: string;
  timeZone: string;
  truncated: boolean;
}

export interface CalendarCapability {
  search(range: { from: Date; to: Date }): Promise<CalendarEvent[]>;
}

export interface CalendarClient extends CalendarCapability {
  listEvents(range: LocalDateRange | InstantRange, opts?: ListEventsOptions): Promise<ListEventsResult>;
}

// ------------------------------------------------------------------ web

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  untrusted?: true;
}

export interface WebCapability {
  search(query: string, opts?: { limit?: number }): Promise<WebResult[]>;
  /**
   * @deprecated Not implemented: fetching model-supplied URLs is out of
   * scope (SSRF / injection surface). Kept optional for type compatibility.
   */
  read?(url: string): Promise<string>;
}
