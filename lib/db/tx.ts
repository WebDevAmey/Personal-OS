// lib/db/tx.ts — transaction helper shared by repositories (docs/02 §2).
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export interface TxOptions {
  /** Join an existing transaction instead of opening a new one. */
  tx?: Tx;
  timeoutMs?: number;
}

/**
 * Runs `fn` in an interactive transaction, or inside `opts.tx` when the
 * caller already holds one (e.g. the command executor, which marks the
 * proposal EXECUTED in the same transaction as the domain change).
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  if (opts.tx) return fn(opts.tx);
  return prisma.$transaction(fn, { timeout: opts.timeoutMs ?? 20_000, maxWait: 10_000 });
}

/** The client to read with: the caller's transaction when given. */
export function reader(tx?: Tx): Tx {
  return tx ?? (prisma as unknown as Tx);
}

/** Postgres unique violation surfaced by Prisma (P2002), optionally on a given constraint/field. */
export function isUniqueViolation(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  if (!target) return true;
  return JSON.stringify(error.meta ?? {}).includes(target);
}
