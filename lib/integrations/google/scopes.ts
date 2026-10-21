// lib/integrations/google/scopes.ts
//
// The only Google API scopes this product may hold (ADR-011, INT-001):
// Gmail read + compose (drafts only, never send) and Calendar read-only.
import { IntegrationScopeError } from '../errors';

const BASE = 'https://www.googleapis.com/auth/';

export const GMAIL_READONLY_SCOPE = `${BASE}gmail.readonly`;
export const GMAIL_COMPOSE_SCOPE = `${BASE}gmail.compose`;
export const CALENDAR_READONLY_SCOPE = `${BASE}calendar.readonly`;

/** Identity scopes requested alongside the API scopes at sign-in. */
export const IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;

export const GOOGLE_API_SCOPES = [GMAIL_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE, CALENDAR_READONLY_SCOPE] as const;

/** Scopes that would let this app send mail or change calendars. Never acceptable. */
export const FORBIDDEN_GOOGLE_SCOPES = [
  'https://mail.google.com/',
  `${BASE}gmail.send`,
  `${BASE}gmail.modify`,
  `${BASE}gmail.insert`,
  `${BASE}gmail.settings.basic`,
  `${BASE}gmail.settings.sharing`,
  `${BASE}calendar`,
  `${BASE}calendar.events`,
  `${BASE}calendar.events.owned`,
  `${BASE}calendar.app.created`,
  `${BASE}calendar.calendars`,
  `${BASE}calendar.acls`,
  `${BASE}calendar.settings`,
] as const;

/** Splits a space- or comma-delimited scope string. */
export function parseScopes(scopes: string | null | undefined): Set<string> {
  return new Set((scopes ?? '').split(/[\s,]+/).filter(Boolean));
}

function assertNoForbidden(provider: 'gmail' | 'calendar', granted: Set<string>): void {
  for (const scope of FORBIDDEN_GOOGLE_SCOPES) {
    if (granted.has(scope)) throw new IntegrationScopeError(provider, 'excessive', scope);
  }
}

/**
 * Calendar access must be exactly read-only: `calendar.readonly` present and
 * no write-capable calendar (or mail-send) scope present.
 */
export function assertCalendarReadonlyScopes(scopes: string | null | undefined): void {
  const granted = parseScopes(scopes);
  assertNoForbidden('calendar', granted);
  if (!granted.has(CALENDAR_READONLY_SCOPE)) throw new IntegrationScopeError('calendar', 'missing', CALENDAR_READONLY_SCOPE);
}

/** Gmail needs `gmail.readonly` for reads; drafts additionally need `gmail.compose`. */
export function assertGmailScopes(scopes: string | null | undefined, opts: { compose?: boolean } = {}): void {
  const granted = parseScopes(scopes);
  assertNoForbidden('gmail', granted);
  if (!granted.has(GMAIL_READONLY_SCOPE)) throw new IntegrationScopeError('gmail', 'missing', GMAIL_READONLY_SCOPE);
  if (opts.compose && !granted.has(GMAIL_COMPOSE_SCOPE)) throw new IntegrationScopeError('gmail', 'missing', GMAIL_COMPOSE_SCOPE);
}
