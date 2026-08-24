import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  notes: text('notes'),
  dueDate: timestamp('due_date', { mode: 'date' }),
  status: text('status', { enum: ['open', 'completed', 'deleted'] }).notNull().default('open'),
  completedAt: timestamp('completed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
