import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const integrationAccounts = pgTable('integration_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: ['google'] }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  scopes: text('scopes').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type IntegrationAccount = typeof integrationAccounts.$inferSelect;
