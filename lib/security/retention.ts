// lib/security/retention.ts
// Retention purge for the security tables (docs/03 §6, SEC-R-012). Run daily
// by inngest/retention.ts.
//
// | Table             | Rule                                   |
// |-------------------|----------------------------------------|
// | RateLimitAttempt  | windowStart < now − 24 h               |
// | AuthEvent         | createdAt < now − 1 year               |
// | WebAuthnChallenge | expiresAt < now − 1 h                  |
// | VerificationToken | expiresAt < now − 24 h                 |
//
// Rows are deleted in batches of RETENTION_BATCH by primary key, each batch
// its own statement, so a large backlog never holds one long lock.
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const RETENTION = {
  rateLimitAttemptMs: DAY_MS,
  authEventMs: 365 * DAY_MS,
  webAuthnChallengeGraceMs: HOUR_MS,
  verificationTokenGraceMs: DAY_MS,
} as const;

export const RETENTION_BATCH = 1000;

export interface RetentionResult {
  rateLimitAttempts: number;
  authEvents: number;
  webAuthnChallenges: number;
  verificationTokens: number;
}

/**
 * Deletes rows of `table` whose `column` is before `cutoff`, batch by batch.
 * `table`, `key` and `column` are compile-time constants from this module,
 * never user input.
 */
async function purgeBefore(table: string, key: string, column: string, cutoff: Date, batch: number): Promise<number> {
  const t = Prisma.raw(`"${table}"`);
  const k = Prisma.raw(`"${key}"`);
  const c = Prisma.raw(`"${column}"`);
  let total = 0;
  for (;;) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM ${t} WHERE ${k} IN (
        SELECT ${k} FROM ${t} WHERE ${c} < ${cutoff} ORDER BY ${k} LIMIT ${batch}
      )`;
    total += deleted;
    if (deleted < batch) return total;
  }
}

export async function purgeSecurityTables(opts: { now?: Date; batch?: number } = {}): Promise<RetentionResult> {
  const now = (opts.now ?? new Date()).getTime();
  const batch = opts.batch ?? RETENTION_BATCH;
  return {
    rateLimitAttempts: await purgeBefore('RateLimitAttempt', 'key', 'windowStart', new Date(now - RETENTION.rateLimitAttemptMs), batch),
    authEvents: await purgeBefore('AuthEvent', 'id', 'createdAt', new Date(now - RETENTION.authEventMs), batch),
    webAuthnChallenges: await purgeBefore('WebAuthnChallenge', 'id', 'expiresAt', new Date(now - RETENTION.webAuthnChallengeGraceMs), batch),
    verificationTokens: await purgeBefore('VerificationToken', 'id', 'expiresAt', new Date(now - RETENTION.verificationTokenGraceMs), batch),
  };
}
