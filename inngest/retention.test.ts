// Daily retention job configuration and registration (SEC-R-012).
import { describe, expect, it, vi } from 'vitest';

const purge = vi.fn(async () => ({ rateLimitAttempts: 2, authEvents: 1, webAuthnChallenges: 0, verificationTokens: 0 }));
vi.mock('@/lib/security/retention', () => ({ purgeSecurityTables: purge }));

const serveArgs: Array<{ functions: unknown[] }> = [];
vi.mock('inngest/next', () => ({
  serve: (opts: { functions: unknown[] }) => {
    serveArgs.push(opts);
    return { GET: () => {}, POST: () => {}, PUT: () => {} };
  },
}));

const { retentionPurgeFn, retentionFunctions } = await import('./retention');

describe('retention-purge', () => {
  it('runs daily at 03:15 UTC, one at a time', () => {
    expect(retentionPurgeFn.opts).toMatchObject({
      id: 'retention-purge',
      concurrency: { limit: 1 },
      triggers: [{ cron: 'TZ=UTC 15 3 * * *' }],
    });
    expect(retentionFunctions).toEqual([retentionPurgeFn]);
  });

  it('is registered with the Inngest serve route', async () => {
    await import('@/app/api/inngest/route');
    expect(serveArgs.at(-1)?.functions).toContain(retentionPurgeFn);
  });

  it('calls the purge inside a step', async () => {
    const handler = (retentionPurgeFn as unknown as { fn: (ctx: unknown) => Promise<unknown> }).fn;
    const ids: string[] = [];
    const step = { run: async (id: string, fn: () => Promise<unknown>) => (ids.push(id), fn()) };
    const result = await handler({ step });
    expect(ids).toEqual(['purge-security-tables']);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ rateLimitAttempts: 2, authEvents: 1 });
  });
});
