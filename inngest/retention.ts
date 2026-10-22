// inngest/retention.ts — daily retention purge of the security tables
// (docs/03 §6, SEC-R-012): expired RateLimitAttempt counters, year-old
// AuthEvent rows, stale WebAuthn challenges and verification tokens, and
// command runs older than 90 days.
import { logger } from '@/lib/observability/logger';
import { purgeSecurityTables } from '@/lib/security/retention';
import { inngest } from './client';

export const retentionPurgeFn = inngest.createFunction(
  {
    id: 'retention-purge',
    name: 'Retention purge (security tables)',
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [{ cron: 'TZ=UTC 15 3 * * *' }],
  },
  async ({ step }) => {
    const result = await step.run('purge-security-tables', () => purgeSecurityTables());
    logger.info('retention.purged', { ...result });
    return result;
  },
);

export const retentionFunctions = [retentionPurgeFn];
