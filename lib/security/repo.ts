// lib/security/repo.ts — database access for security housekeeping
// (ARCH-001: the only file under lib/security that touches '@/lib/prisma'
// besides the legacy auth-rate-limit.ts).
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/** Tables the retention purge may delete from, with their key and the column the cutoff applies to. */
export const PURGEABLE = {
  RateLimitAttempt: { key: 'key', column: 'windowStart' },
  AuthEvent: { key: 'id', column: 'createdAt' },
  WebAuthnChallenge: { key: 'id', column: 'expiresAt' },
  VerificationToken: { key: 'id', column: 'expiresAt' },
} as const;

export type PurgeableTable = keyof typeof PURGEABLE;

/**
 * Deletes the rows of `table` whose cutoff column is before `cutoff`, at most
 * `batch` rows per statement, until none are left. Identifiers come from the
 * constant PURGEABLE map, never from input. Returns the number deleted.
 */
export async function deleteRowsBefore(table: PurgeableTable, cutoff: Date, batch: number): Promise<number> {
  const { key, column } = PURGEABLE[table];
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
