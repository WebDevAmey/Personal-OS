import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/db/client';
import { users, accounts, sessions, verificationTokens } from '@/db/schema';
import { persistIntegrationAccount } from '@/lib/auth/persist-integration-account';

export const { handlers, auth, signIn, signOut } = NextAuth({
  // `db/schema/users.ts` defines `users`/`accounts`/`sessions`/`verificationTokens`
  // in the exact shape @auth/drizzle-adapter expects, so wire it in here instead
  // of hand-rolling user upserts. The adapter now creates/updates the `users` row
  // and writes the OAuth `accounts` row (provider, providerAccountId, tokens) for
  // us on every sign-in.
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // Explicit for clarity: Auth.js already defaults `session.strategy` to
  // "database" whenever an `adapter` is configured (see @auth/core's
  // `lib/init.js`), but we set it explicitly so the intent (schema-backed
  // sessions, not JWT) survives future refactors even if the adapter is
  // ever swapped or wrapped.
  session: {
    strategy: 'database',
  },
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
  events: {
    // IMPORTANT: this must be an `events.signIn` handler, not a
    // `callbacks.signIn` handler. Auth.js runs `callbacks.signIn` *before*
    // the adapter has persisted anything (it only gates access), so at that
    // point the `users`/`accounts` rows don't exist yet for a first-time
    // sign-in and `user.id` is just the provider-derived id off the OAuth
    // profile. `events.signIn` fires after `handleLoginOrRegister` has run
    // the adapter's `createUser`/`getUserByAccount` + `linkAccount`, so
    // `user.id` here is guaranteed to be the real persisted `users.id` that
    // `integration_accounts.user_id` can safely reference, and `account`
    // still carries the full Google token set (access_token, refresh_token,
    // scope, expires_at) needed below.
    async signIn({ user, account }) {
      if (account?.provider === 'google' && user.id) {
        await persistIntegrationAccount(user.id, {
          accessToken: account.access_token!,
          refreshToken: account.refresh_token,
          scopes: account.scope ?? '',
          expiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
        });
      }
    },
  },
});
