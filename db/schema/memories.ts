import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { vector } from '../vector-type';

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 512 }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type Memory = typeof memories.$inferSelect;
