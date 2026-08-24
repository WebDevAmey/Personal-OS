import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withIdempotency } from './idempotency';
import { db } from '@/db/client';

vi.mock('@/db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));

describe('withIdempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the action and records it when the key has not been seen', async () => {
    (db.select as any).mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    const values = vi.fn().mockResolvedValue(undefined);
    (db.insert as any).mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-1' });
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-1', input: { title: 'x' } }, action);

    expect(action).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 'task-1' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'key-1', status: 'success' }));
  });

  it('skips re-running the action when the key was already recorded', async () => {
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ output: { id: 'task-1' } }]) }),
    });

    const action = vi.fn();
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-1', input: { title: 'x' } }, action);

    expect(action).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'task-1' });
  });
});
