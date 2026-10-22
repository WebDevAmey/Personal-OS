// lib/auth/lockout.ts
// Atomic password-attempt accounting (SEC-B-001).
//
// Each password check first RESERVES an attempt with one UPDATE whose WHERE
// clause refuses the reservation once the budget is spent or a lock is
// active. Postgres re-evaluates that WHERE against the latest row version for
// every concurrent UPDATE, so N parallel guesses can reserve at most
// MAX_FAILED_ATTEMPTS slots in total; the rest are refused before bcrypt runs.
// The reservation that uses the last slot sets the lock in the same
// statement, so a crashed request can never leave an account at the limit
// without an expiry. A correct password releases the reservation.
//
// An expired lock is treated as served: the next reservation starts a fresh
// budget at 1 and clears the old lockedUntil.
import { prisma } from '@/lib/prisma';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 15 * 60;

export type Reservation = { reserved: true; attempt: number; lockedNow: boolean } | { reserved: false };

export async function reservePasswordAttempt(userId: string): Promise<Reservation> {
  const rows = await prisma.$queryRaw<{ failedLoginAttempts: number; lockedUntil: Date | null }[]>`
    WITH now_utc AS (SELECT (now() AT TIME ZONE 'UTC') AS ts)
    UPDATE "User" u SET
      "failedLoginAttempts" = CASE
        WHEN u."lockedUntil" IS NOT NULL AND u."lockedUntil" <= n.ts THEN 1
        ELSE u."failedLoginAttempts" + 1
      END,
      "lockedUntil" = CASE
        WHEN (CASE WHEN u."lockedUntil" IS NOT NULL AND u."lockedUntil" <= n.ts THEN 1 ELSE u."failedLoginAttempts" + 1 END) >= ${MAX_FAILED_ATTEMPTS}
          THEN n.ts + make_interval(secs => ${LOCKOUT_SECONDS})
        WHEN u."lockedUntil" IS NOT NULL AND u."lockedUntil" <= n.ts THEN NULL
        ELSE u."lockedUntil"
      END
    FROM now_utc n
    WHERE u."id" = ${userId}
      AND (
        (u."lockedUntil" IS NOT NULL AND u."lockedUntil" <= n.ts)
        OR (u."lockedUntil" IS NULL AND u."failedLoginAttempts" < ${MAX_FAILED_ATTEMPTS})
      )
    RETURNING u."failedLoginAttempts", u."lockedUntil"
  `;
  const row = rows[0];
  if (!row) return { reserved: false };
  const attempt = Number(row.failedLoginAttempts);
  return { reserved: true, attempt, lockedNow: attempt >= MAX_FAILED_ATTEMPTS };
}

/** Called after a correct password: the reserved attempt was legitimate. */
export async function clearFailedAttempts(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
}
