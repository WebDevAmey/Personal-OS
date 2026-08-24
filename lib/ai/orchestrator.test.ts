import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from './orchestrator';
import { db } from '@/db/client';
import type { checkRateLimit } from '@/lib/rate-limit';

const mockInsertReturning = vi.fn();
const mockUpdateWhere = vi.fn();
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));

vi.mock('@/db/client', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: mockInsertReturning })) })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
  },
}));

const mockGenerateText = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: (...args: Parameters<typeof actual.generateText>) => mockGenerateText(...args) };
});

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: Parameters<typeof checkRateLimit>) => mockCheckRateLimit(...args),
}));

function makeCtx() {
  return {
    userId: 'user-1',
    email: { search: vi.fn(), read: vi.fn(), draft: vi.fn() },
    calendar: { search: vi.fn() },
    web: { search: vi.fn(), read: vi.fn() },
  };
}

describe('runCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockInsertReturning.mockResolvedValue([{ id: 'run-1' }]);
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  it('logs an agent_run and returns the model\'s final confirmation text', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Moved it to Friday.', steps: [{ toolCalls: [{ toolName: 'update_task' }] }], usage: { totalTokens: 120 } });

    const result = await runCommand(makeCtx(), 'Move the assignment to Friday');

    expect(result.message).toBe('Moved it to Friday.');
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
    // Finding 8: assert on the actual persisted payload, not just that
    // db.update was called - a bug that dropped/mis-shaped toolCalls or
    // tokenCost while still calling .update() once would previously have
    // slipped past this test undetected.
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      toolCalls: ['update_task'],
      tokenCost: 120,
    }));
  });

  it('returns the rate-limit message and skips the model call and agent_run insert when the bucket is exhausted', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });

    const result = await runCommand(makeCtx(), 'Move the assignment to Friday');

    expect(result.message).toBe("You've hit the rate limit for commands — try again in a minute.");
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
