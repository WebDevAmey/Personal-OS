import { describe, it, expect, vi } from 'vitest';
import { buildToolRegistry } from './index';

vi.mock('@/lib/tasks/queries', () => ({
  createTask: vi.fn(async (userId, input) => ({ id: 'task-1', userId, ...input, status: 'open' })),
  updateTask: vi.fn(), completeTask: vi.fn(), deleteTask: vi.fn(), searchTasks: vi.fn(async () => []),
}));
vi.mock('@/lib/memory/queries', () => ({
  saveMemory: vi.fn(async (userId, content) => ({ id: 'mem-1', userId, content })),
  searchMemory: vi.fn(async () => []),
}));
vi.mock('@/lib/ai/idempotency', () => ({
  withIdempotency: vi.fn((_ctx, action) => action()),
}));

describe('buildToolRegistry', () => {
  it('exposes exactly the 11 V1 tools', () => {
    const registry = buildToolRegistry({
      userId: 'user-1',
      agentRunId: 'run-1',
      email: { search: vi.fn(), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn() },
      web: { search: vi.fn(), read: vi.fn() },
    });

    expect(Object.keys(registry).sort()).toEqual([
      'complete_task', 'create_email_draft', 'create_task', 'delete_task',
      'list_calendar_events', 'save_memory', 'search_email', 'search_memory',
      'search_tasks', 'search_web', 'update_task',
    ]);
  });

  it('create_task executes through withIdempotency and returns the created task', async () => {
    const registry = buildToolRegistry({
      userId: 'user-1', agentRunId: 'run-1',
      email: { search: vi.fn(), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn() },
      web: { search: vi.fn(), read: vi.fn() },
    });

    const result = await registry.create_task.execute(
      { title: 'Finish assembler assignment' },
      { toolCallId: 'call-1', messages: [] } as unknown as Parameters<typeof registry.create_task.execute>[1],
    );
    expect(result).toEqual(expect.objectContaining({ title: 'Finish assembler assignment', userId: 'user-1' }));
  });
});
