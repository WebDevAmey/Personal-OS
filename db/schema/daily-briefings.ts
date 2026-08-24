import { pgTable, uuid, text, timestamp, jsonb, date } from 'drizzle-orm/pg-core';
import { users } from './users';

export const dailyBriefings = pgTable('daily_briefings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  briefingDate: date('briefing_date').notNull(),
  attentionItems: jsonb('attention_items').notNull(),
  digestItems: jsonb('digest_items').notNull(),
  generatedAt: timestamp('generated_at', { mode: 'date' }).notNull().defaultNow(),
});
export type DailyBriefing = typeof dailyBriefings.$inferSelect;
