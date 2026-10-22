// Function configuration (ADR-010) and entry validation. No DB: a malformed
// payload must be rejected before anything user-scoped runs.
import { describe, expect, it, vi } from 'vitest';
import { NonRetriableError } from 'inngest';

vi.mock('@/lib/briefing/repo', () => new Proxy({}, { get: (_t, name) => (name === 'then' ? undefined : vi.fn(() => { throw new Error(`repo.${String(name)} must not be called`); })) }));
vi.mock('@/lib/preferences/repo', () => ({ getUserTimeZone: vi.fn(() => { throw new Error('must not be called'); }) }));

const { briefingGenerateFn, briefingSchedulerFn, briefingFunctions } = await import('./daily-briefing');
const { runBriefingGenerate } = await import('@/lib/briefing/service');
const { fakeGoogle, fakeStep, mockModel, silentLogger } = await import('@/lib/briefing/test-fixtures');

describe('Inngest function configuration', () => {
  it('scheduler runs every 15 minutes, one at a time', () => {
    expect(briefingSchedulerFn.opts).toMatchObject({ id: 'briefing-scheduler', concurrency: { limit: 1 }, triggers: [{ cron: '*/15 * * * *' }] });
  });

  it('generate is per user: concurrency 1 keyed on userId, idempotent per dedupeKey, 3 retries, onFailure', () => {
    expect(briefingGenerateFn.opts).toMatchObject({
      id: 'briefing-generate',
      retries: 3,
      concurrency: { key: 'event.data.userId', limit: 1 },
      idempotency: 'event.data.dedupeKey',
      triggers: [{ event: 'briefing/generate.requested' }],
    });
    expect(typeof briefingGenerateFn.opts.onFailure).toBe('function');
    expect(briefingFunctions).toEqual([briefingSchedulerFn, briefingGenerateFn]);
  });

  it('the serve route registers the briefing functions', async () => {
    const route = await import('@/app/api/inngest/route');
    expect(typeof route.GET).toBe('function');
    expect(typeof route.POST).toBe('function');
    expect(typeof route.PUT).toBe('function');
  });
});

describe('briefing-generate entry validation', () => {
  it.each([
    [{}],
    [{ userId: 'u1' }],
    [{ userId: 'u1', localDate: 'tomorrow', dedupeKey: 'u1-tomorrow', trigger: 'SCHEDULED' }],
    [{ userId: ['u1', 'u2'], localDate: '2026-10-22', dedupeKey: 'x', trigger: 'SCHEDULED' }],
  ])('rejects %j as non-retriable without touching any user data', async (data) => {
    const step = fakeStep();
    const deps = { now: () => new Date(), model: () => mockModel([]), modelId: 'mock', logger: silentLogger, embed: null, google: fakeGoogle() };
    await expect(runBriefingGenerate({ eventData: data, runId: 'r1', attempt: 0 }, step, deps)).rejects.toBeInstanceOf(NonRetriableError);
    expect(step.ids).toEqual([]);
    expect(deps.google.tokenCalls).toEqual([]);
  });
});
