// scripts/encrypt-integration-tokens.ts — seal integration tokens at rest as
// row-bound v2 ciphertext (ADR-011, docs/03 §7.4, SEC-B-017, SEC-R-009).
//
//   pnpm db:encrypt-tokens            # reseal plaintext and v1 rows
//   pnpm db:encrypt-tokens -- --check # count rows still to reseal, change nothing
//
// Idempotent: v2 rows are skipped. Each row is written with a compare-and-set
// on both old values, so a concurrent refresh is never overwritten. Prints
// counts only, never token values. Exits 1 while rows remain.
import { pathToFileURL } from 'node:url';
import { prisma } from '@/lib/prisma';
import { decryptToken, encryptToken, isEncryptedToken, needsReseal, tokenContext, type TokenColumn } from '@/lib/security/token-crypto';

export interface ResealResult {
  scanned: number;
  pending: number;
  resealed: number;
  changedConcurrently: number;
  undecryptable: number;
}

const BATCH = 200;

function reseal(value: string, userId: string, provider: string, column: TokenColumn): string {
  const context = tokenContext(userId, provider, column);
  const plaintext = isEncryptedToken(value) ? decryptToken(value, context) : value;
  return encryptToken(plaintext, context);
}

export async function resealIntegrationTokens(opts: { dryRun?: boolean } = {}): Promise<ResealResult> {
  const result: ResealResult = { scanned: 0, pending: 0, resealed: 0, changedConcurrently: 0, undecryptable: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.integrationAccount.findMany({
      select: { id: true, userId: true, provider: true, accessToken: true, refreshToken: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) return result;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      result.scanned++;
      const refreshPending = row.refreshToken !== null && needsReseal(row.refreshToken);
      if (!needsReseal(row.accessToken) && !refreshPending) continue;
      result.pending++;
      if (opts.dryRun) continue;

      let accessToken: string;
      let refreshToken: string | null;
      try {
        accessToken = needsReseal(row.accessToken) ? reseal(row.accessToken, row.userId, row.provider, 'accessToken') : row.accessToken;
        refreshToken = row.refreshToken && refreshPending ? reseal(row.refreshToken, row.userId, row.provider, 'refreshToken') : row.refreshToken;
      } catch {
        // Wrong key or a tampered value: leave the row; the app asks the user to reconnect.
        result.undecryptable++;
        continue;
      }
      const { count } = await prisma.integrationAccount.updateMany({
        where: { id: row.id, accessToken: row.accessToken, refreshToken: row.refreshToken },
        data: { accessToken, refreshToken },
      });
      if (count === 1) result.resealed++;
      else result.changedConcurrently++;
    }
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--check');
  const result = await resealIntegrationTokens({ dryRun });
  console.log(JSON.stringify({ dryRun, ...result }));
  const remaining = dryRun ? result.pending : result.pending - result.resealed;
  await prisma.$disconnect();
  process.exit(remaining === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ error: (err as Error)?.name ?? 'Error' }));
    process.exit(1);
  });
}
