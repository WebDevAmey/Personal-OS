import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withIdempotency } from './idempotency';
import { db } from '@/db/client';
import { agentActions } from '@/db/schema';

vi.mock('@/db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn(), delete: vi.fn() },
}));

const mockedDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe('withIdempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the action and records it when the key has not been seen', async () => {
    mockedDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    const values = vi.fn().mockResolvedValue(undefined);
    mockedDb.insert.mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-1' });
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-1', input: { title: 'x' } }, action);

    expect(action).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 'task-1' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'key-1', status: 'success' }));
  });

  it('skips re-running the action when the key was already recorded as a success', async () => {
    mockedDb.select.mockReturnValue({
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
    mockedDb.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ output: { error: 'boom' }, status: 'error' }]) }),
    });
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    mockedDb.delete.mockReturnValue({ where: deleteWhere });
    const values = vi.fn().mockResolvedValue(undefined);
    mockedDb.insert.mockReturnValue({ values });

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
    mockedDb.select.mockImplementation(() => ({
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
    mockedDb.insert.mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-mine' });
    const result = await withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-race', input: { title: 'x' } }, action);

    // The race is inherent (this call already ran action() before losing
    // the insert) - what matters is that the caller gets back a single,
    // consistent result: the winner's, not a thrown error.
    expect(action).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 'task-winner' });
  });

  // Re-review finding: call A's action() fails and its 'error' row wins the
  // insert race; call B's action() succeeds but loses that race. B must not
  // discard its own valid output by throwing the raw conflict error, and it
  // must not leave A's stale 'error' row in place either (that would cause
  // the next retry to delete-and-rerun the action a third time). B should
  // clear the stale row and persist its own success under the freed key.
  it('clears a stale error row and persists its own output when the success-path insert loses a race against it', async () => {
    let selectCallCount = 0;
    mockedDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          // 1st call: this call's own initial check - no row yet (both A
          // and B start from a clean key).
          if (selectCallCount === 1) return Promise.resolve([]);
          // 2nd call: re-fetch inside loadWinningSuccessOutput after losing
          // the insert race - A's stale 'error' row is now visible (A's
          // action() failed and its error row won the insert race).
          return Promise.resolve([{ output: { error: 'boom' }, status: 'error' }]);
        },
      }),
    }));
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    mockedDb.delete.mockReturnValue({ where: deleteWhere });

    const uniqueViolation = Object.assign(
      new Error('duplicate key value violates unique constraint "agent_actions_idempotency_key_unique"'),
      { code: '23505' },
    );
    const values = vi.fn().mockRejectedValueOnce(uniqueViolation).mockResolvedValueOnce(undefined);
    mockedDb.insert.mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-mine' });
    const result = await withIdempotency(
      { agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-stale-error', input: { title: 'x' } },
      action,
    );

    expect(action).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 'task-mine' });
    expect(db.delete).toHaveBeenCalledWith(agentActions);
    expect(deleteWhere).toHaveBeenCalled();
    // First attempt hit the unique-constraint conflict, second is the retry
    // that actually persists our own successful output.
    expect(values).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: 'key-stale-error', status: 'success', output: { id: 'task-mine' } }),
    );
  });

  // Re-review finding: the retry insert after clearing a stale error row
  // (previous test) was wrapped in an unconditional `catch {}` that treated
  // ANY failure as the rare "third concurrent writer" case. If the retry
  // insert instead fails for an unrelated reason (network blip, timeout,
  // etc), the row is left deleted with nothing re-inserted and no record of
  // why. The retry's catch must discriminate: only a genuine unique
  // violation is the documented benign race; anything else must be logged
  // so the lost bookkeeping is visible, while still returning `output`
  // since the caller's action() did genuinely succeed.
  it('logs and still returns output when the retry insert after clearing a stale row fails for a non-unique-violation reason', async () => {
    let selectCallCount = 0;
    mockedDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          if (selectCallCount === 1) return Promise.resolve([]);
          return Promise.resolve([{ output: { error: 'boom' }, status: 'error' }]);
        },
      }),
    }));
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    mockedDb.delete.mockReturnValue({ where: deleteWhere });

    const uniqueViolation = Object.assign(
      new Error('duplicate key value violates unique constraint "agent_actions_idempotency_key_unique"'),
      { code: '23505' },
    );
    const connectionError = new Error('connection reset');
    const values = vi.fn().mockRejectedValueOnce(uniqueViolation).mockRejectedValueOnce(connectionError);
    mockedDb.insert.mockReturnValue({ values });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const action = vi.fn().mockResolvedValue({ id: 'task-mine' });
    const result = await withIdempotency(
      { agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-stale-error-2', input: { title: 'x' } },
      action,
    );

    expect(result).toEqual({ id: 'task-mine' });
    expect(values).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0].join(' ')).toContain('key-stale-error-2');

    consoleErrorSpy.mockRestore();
  });

  it('propagates a non-unique-constraint insert error instead of swallowing it', async () => {
    mockedDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    const dbError = new Error('connection reset');
    const values = vi.fn().mockRejectedValue(dbError);
    mockedDb.insert.mockReturnValue({ values });

    const action = vi.fn().mockResolvedValue({ id: 'task-3' });

    await expect(
      withIdempotency({ agentRunId: 'run-1', toolName: 'create_task', idempotencyKey: 'key-3', input: {} }, action),
    ).rejects.toThrow('connection reset');
  });
});
