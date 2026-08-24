import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { persistIntegrationAccount } from '@/lib/auth/persist-integration-account';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: [
            'openid', 'email', 'profile',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.compose',
            'https://www.googleapis.com/auth/calendar.readonly',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google' && user.id) {
        // No Auth.js adapter is configured (V1 uses JWT sessions), so nothing
        // else creates the `users` row. Every domain table (integration_accounts,
        // tasks, memories, ...) has a NOT NULL FK to users.id, so we upsert it
        // here ourselves before persisting the Google tokens, or the insert
        // below would fail with a foreign-key violation on every real sign-in.
        await db.insert(users).values({
          id: user.id,
          name: user.name ?? null,
          email: user.email!,
          image: user.image ?? null,
        }).onConflictDoUpdate({
          target: users.id,
          set: {
            name: user.name ?? null,
            email: user.email!,
            image: user.image ?? null,
          },
        });

        await persistIntegrationAccount(user.id, {
          accessToken: account.access_token!,
          refreshToken: account.refresh_token,
          scopes: account.scope ?? '',
          expiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
        });
      }
      return true;
    },
  },
});
