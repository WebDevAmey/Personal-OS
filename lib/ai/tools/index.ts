import { tool } from 'ai';
import { z } from 'zod';
import { createTask, updateTask, completeTask, deleteTask, searchTasks } from '@/lib/tasks/queries';
import { saveMemory, searchMemory } from '@/lib/memory/queries';
import { withIdempotency } from '@/lib/ai/idempotency';
import type { EmailCapability, CalendarCapability, WebCapability } from '@/lib/integrations/types';

export interface ToolContext {
  userId: string;
  agentRunId: string;
  email: EmailCapability;
  calendar: CalendarCapability;
  web: WebCapability;
}

export function buildToolRegistry(ctx: ToolContext) {
  const idempotent = <T>(toolName: string, toolCallId: string, input: unknown, action: () => Promise<T>) =>
    withIdempotency({ agentRunId: ctx.agentRunId, toolName, idempotencyKey: `${ctx.agentRunId}:${toolCallId}`, input }, action);

  return {
    create_task: tool({
      description: 'Create a new task for the user.',
      inputSchema: z.object({ title: z.string(), dueDate: z.string().datetime().optional(), notes: z.string().optional() }),
      execute: async ({ title, dueDate, notes }, { toolCallId }) =>
        idempotent('create_task', toolCallId, { title, dueDate, notes }, () =>
          createTask(ctx.userId, { title, notes, dueDate: dueDate ? new Date(dueDate) : undefined })),
    }),

    update_task: tool({
      description: 'Update an existing task the user owns (title, due date, or notes).',
      inputSchema: z.object({ taskId: z.string(), title: z.string().optional(), dueDate: z.string().datetime().optional(), notes: z.string().optional() }),
      execute: async ({ taskId, title, dueDate, notes }, { toolCallId }) =>
        idempotent('update_task', toolCallId, { taskId, title, dueDate, notes }, () =>
          updateTask(ctx.userId, taskId, { title, notes, dueDate: dueDate ? new Date(dueDate) : undefined })),
    }),

    complete_task: tool({
      description: 'Mark a task as completed.',
      inputSchema: z.object({ taskId: z.string() }),
      execute: async ({ taskId }, { toolCallId }) =>
        idempotent('complete_task', toolCallId, { taskId }, () => completeTask(ctx.userId, taskId)),
    }),

    delete_task: tool({
      description: 'Delete (soft-delete) a task.',
      inputSchema: z.object({ taskId: z.string() }),
      execute: async ({ taskId }, { toolCallId }) =>
        idempotent('delete_task', toolCallId, { taskId }, () => deleteTask(ctx.userId, taskId)),
    }),

    search_tasks: tool({
      description: 'Search the user\'s tasks by title text, status, or due date, to find the right task before acting on it.',
      inputSchema: z.object({ query: z.string().optional(), status: z.enum(['open', 'completed', 'deleted']).optional(), dueBefore: z.string().datetime().optional() }),
      execute: async ({ query, status, dueBefore }) =>
        searchTasks(ctx.userId, { query, status, dueBefore: dueBefore ? new Date(dueBefore) : undefined }),
    }),

    save_memory: tool({
      description: 'Save a freeform memory or reminder for later semantic recall.',
      inputSchema: z.object({ content: z.string() }),
      execute: async ({ content }, { toolCallId }) =>
        idempotent('save_memory', toolCallId, { content }, () => saveMemory(ctx.userId, content)),
    }),

    search_memory: tool({
      description: 'Semantically search the user\'s saved memories.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => searchMemory(ctx.userId, query),
    }),

    search_email: tool({
      description: 'Search the user\'s Gmail inbox.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ctx.email.search(query),
    }),

    create_email_draft: tool({
      description: 'Create a Gmail draft reply or new email.',
      inputSchema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      execute: async (input, { toolCallId }) =>
        idempotent('create_email_draft', toolCallId, input, () => ctx.email.draft(input)),
    }),

    list_calendar_events: tool({
      description: 'List the user\'s Google Calendar events in a date range (read-only).',
      inputSchema: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
      execute: async ({ from, to }) => ctx.calendar.search({ from: new Date(from), to: new Date(to) }),
    }),

    search_web: tool({
      description: 'Search the public web for information not available in the user\'s own data.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ctx.web.search(query),
    }),
  };
}
