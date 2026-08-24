import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { users } from './users';

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  input: text('input').notNull(),
  toolCalls: jsonb('tool_calls'),
  latencyMs: integer('latency_ms'),
  tokenCost: integer('token_cost'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type AgentRun = typeof agentRuns.$inferSelect;

export const agentActions = pgTable('agent_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentRunId: uuid('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  status: text('status', { enum: ['success', 'error'] }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
export type AgentAction = typeof agentActions.$inferSelect;
export type NewAgentAction = typeof agentActions.$inferInsert;
