import { google } from 'googleapis';
import type { EmailCapability, EmailMessage } from '../types';

function header(headers: { name?: string | null; value?: string | null }[] | undefined, name: string): string {
  return headers?.find((h) => h.name === name)?.value ?? '';
}

export function createGmailCapability(accessToken: string): EmailCapability {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  return {
    async search(query: string): Promise<EmailMessage[]> {
      const list = await gmail.users.messages.list({ userId: 'me', q: query });
      const ids = list.data.messages ?? [];
      const messages = await Promise.all(ids.map(async ({ id }) => {
        const msg = await gmail.users.messages.get({ userId: 'me', id: id! });
        return {
          id: msg.data.id!,
          from: header(msg.data.payload?.headers, 'From'),
          subject: header(msg.data.payload?.headers, 'Subject'),
          snippet: msg.data.snippet ?? '',
          receivedAt: new Date(Number(msg.data.internalDate)),
        };
      }));
      return messages;
    },

    async read(id: string) {
      const msg = await gmail.users.messages.get({ userId: 'me', id });
      return {
        id: msg.data.id!,
        from: header(msg.data.payload?.headers, 'From'),
        subject: header(msg.data.payload?.headers, 'Subject'),
        snippet: msg.data.snippet ?? '',
        receivedAt: new Date(Number(msg.data.internalDate)),
        body: msg.data.snippet ?? '',
      };
    },

    async draft({ to, subject, body }) {
      const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`).toString('base64url');
      const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
      return { draftId: res.data.id! };
    },
  };
}
