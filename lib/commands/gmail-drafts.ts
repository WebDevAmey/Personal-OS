// lib/commands/gmail-drafts.ts — finds a draft by its deterministic
// Message-ID so a retried confirm adopts the draft a crashed attempt already
// created instead of creating a second one (docs/04 §11.3).
//
// Lives here because lib/integrations/gmail has no lookup yet; it reuses the
// integration's callGoogle wrapper (timeout + typed, token-free errors).
// Requested from WS-3: move this onto GmailClient.
import { google } from 'googleapis';
import { callGoogle, type GoogleCallContext } from '@/lib/integrations/google/api-call';

const MESSAGE_ID = /^<[A-Za-z0-9._-]{1,100}@[A-Za-z0-9.-]{1,100}>$/;

export async function findDraftByMessageId(
  accessToken: string,
  messageIdHeader: string,
  ctx: Omit<GoogleCallContext, 'provider'> = {},
): Promise<{ draftId: string } | null> {
  if (!MESSAGE_ID.test(messageIdHeader)) return null;
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await callGoogle({ provider: 'gmail', ...ctx }, 'drafts.list', (o) =>
    gmail.users.drafts.list({ userId: 'me', q: `rfc822msgid:${messageIdHeader}`, maxResults: 1 }, o));
  const id = res.data.drafts?.[0]?.id;
  return typeof id === 'string' && id.length > 0 ? { draftId: id } : null;
}
