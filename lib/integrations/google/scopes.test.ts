// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SCOPES as SIGN_IN_SCOPES } from '@/lib/auth/google-oauth';
import { IntegrationScopeError } from '../errors';
import {
  CALENDAR_READONLY_SCOPE,
  FORBIDDEN_GOOGLE_SCOPES,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READONLY_SCOPE,
  GOOGLE_API_SCOPES,
  IDENTITY_SCOPES,
  assertCalendarReadonlyScopes,
  assertGmailScopes,
  parseScopes,
} from './scopes';

describe('INT-001: requested Google scopes', () => {
  it('sign-in requests exactly identity + gmail.readonly + gmail.compose + calendar.readonly', () => {
    expect([...parseScopes(SIGN_IN_SCOPES)].sort()).toEqual([...IDENTITY_SCOPES, ...GOOGLE_API_SCOPES].sort());
  });

  it('never requests a send-capable or calendar-write scope', () => {
    const requested = parseScopes(SIGN_IN_SCOPES);
    for (const forbidden of FORBIDDEN_GOOGLE_SCOPES) expect(requested.has(forbidden)).toBe(false);
  });
});

describe('assertCalendarReadonlyScopes', () => {
  it('accepts a grant with calendar.readonly', () => {
    expect(() => assertCalendarReadonlyScopes(`openid ${GMAIL_READONLY_SCOPE} ${CALENDAR_READONLY_SCOPE}`)).not.toThrow();
  });

  it('rejects a grant missing calendar.readonly', () => {
    expect(() => assertCalendarReadonlyScopes(GMAIL_READONLY_SCOPE)).toThrow(IntegrationScopeError);
  });

  it.each(['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'])(
    'rejects a grant holding a write scope (%s)',
    (scope) => {
      expect(() => assertCalendarReadonlyScopes(`${CALENDAR_READONLY_SCOPE} ${scope}`)).toThrow(/unexpected scope/);
    },
  );
});

describe('assertGmailScopes', () => {
  it('requires gmail.compose only for drafts', () => {
    expect(() => assertGmailScopes(GMAIL_READONLY_SCOPE)).not.toThrow();
    expect(() => assertGmailScopes(GMAIL_READONLY_SCOPE, { compose: true })).toThrow(IntegrationScopeError);
    expect(() => assertGmailScopes(`${GMAIL_READONLY_SCOPE} ${GMAIL_COMPOSE_SCOPE}`, { compose: true })).not.toThrow();
  });

  it('rejects gmail.send and full mail access', () => {
    expect(() => assertGmailScopes(`${GMAIL_READONLY_SCOPE} https://www.googleapis.com/auth/gmail.send`)).toThrow(IntegrationScopeError);
    expect(() => assertGmailScopes(`${GMAIL_READONLY_SCOPE} https://mail.google.com/`)).toThrow(IntegrationScopeError);
  });
});
