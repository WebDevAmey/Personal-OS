import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withIdempotency } from './idempotency';
import { db } from '@/db/client';
import { agentActions } from '@/db/schema';

vi.mock('@/db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn(), delete: vi.fn() },
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

  it('skips re-running the action when the key was already recorded as a success', async () => {
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ output: { id: 'task-1' }, status: 'success' }]) }),
    });

    const action = vi.fn();
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-1', input: { title: 'x' } }, action);

    expect(action).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'task-1' });
  });

  // Finding 1: a failed prior attempt must not be replayed back as a cached
  // success - the action needs a genuine chance to succeed on retry.
  it('re-runs the action when the existing row recorded a failure, instead of treating it as cached success', async () => {
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ output: { error: 'boom' }, status: 'error' }]) }),
    });
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    (db.delete as any).mockReturnValue({ where: deleteWhere });
    const values = vi.fn().mockResolvedValue(undefined);
    (db.insert as any).mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-2' });
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-1', input: { title: 'x' } }, action);

    expect(action).toHaveBeenCalledOnce();
    expect(db.delete).toHaveBeenCalledWith(agentActions);
    expect(deleteWhere).toHaveBeenCalled();
    expect(result).toEqual({ id: 'task-2' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'key-1', status: 'success', output: { id: 'task-2' } }));
  });

  // Finding 2: two concurrent calls with the same idempotency key can both
  // pass the initial "no existing row" check and both run action(). The
  // loser's insert then hits the unique-constraint violation on
  // idempotencyKey - it should defer to the winning row's output instead of
  // throwing (or trying, and failing again, to insert a second conflicting
  // row).
  it('resolves to the winning row when insert loses a unique-constraint race against a concurrent call for the same key', async () => {
    let selectCallCount = 0;
    (db.select as any).mockImplementation(() => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          // 1st call: this call's own initial check - no row yet.
          if (selectCallCount === 1) return Promise.resolve([]);
          // 2nd call: re-fetch after losing the insert race - the
          // concurrent call's row is now visible.
          return Promise.resolve([{ output: { id: 'task-winner' }, status: 'success' }]);
        },
      }),
    }));

    const uniqueViolation = Object.assign(
      new Error('duplicate key value violates unique constraint "agent_actions_idempotency_key_unique"'),
      { code: '23505' },
    );
    const values = vi.fn().mockRejectedValue(uniqueViolation);
    (db.insert as any).mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-mine' });
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-race', input: { title: 'x' } }, action);

    // The race is inherent (this call already ran action() before losing
    // the insert) - what matters is that the caller gets back a single,
    // consistent result: the winner's, not a thrown error.
    expect(action).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 'task-winner' });
  });

  it('propagates a non-unique-constraint insert error instead of swallowing it', async () => {
    (db.select as any).mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    const dbError = new Error('connection reset');
    const values = vi.fn().mockRejectedValue(dbError);
    (db.insert as any).mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-3' });

    await expect(
      withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-3', input: {} }, action),
    ).rejects.toThrow('connection reset');
  });
});
