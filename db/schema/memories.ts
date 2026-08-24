import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { vector } from '../vector-type';

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  // The `memories_embedding_idx` HNSW index on this column lives in the
  // hand-authored db/migrations/0002_memories_embedding_hnsw_index.sql, not
  // here - the `vector` custom type has no .op()/index support, so it's
  // invisible to Drizzle's schema diffing. Never run `drizzle-kit push` on
  // this project (it would see the index as unmanaged drift and could drop
  // it) - only `drizzle-kit migrate`.
  embedding: vector('embedding', { dimensions: 512 }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type Memory = typeof memories.$inferSelect;
