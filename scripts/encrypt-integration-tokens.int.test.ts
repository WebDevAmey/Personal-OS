// Re-sealing integration tokens at rest (docs/03 §7.4, SEC-B-017, SEC-R-009),
// against the real test database.
import { afterAll, describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { deleteUsers, makeUser } from '@/lib/test/factories';
import { decryptToken, encryptToken, tokenContext } from '@/lib/security/token-crypto';
import { resealIntegrationTokens } from './encrypt-integration-tokens';

const userIds: string[] = [];
afterAll(() => deleteUsers(...userIds));

function sealV1(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

/** Inserts a row the way it looked before encryption, bypassing the format check. */
async function legacyRow(userId: string, accessToken: string, refreshToken: string | null) {
  await prisma.$executeRaw`
    ALTER TABLE "IntegrationAccount" DROP CONSTRAINT IF EXISTS "IntegrationAccount_token_format_check"`;
  try {
    await prisma.integrationAccount.create({ data: { userId, provider: 'google', accessToken, refreshToken, scopes: 'gmail.readonly' } });
  } finally {
    await prisma.$executeRaw`
      ALTER TABLE "IntegrationAccount" ADD CONSTRAINT "IntegrationAccount_token_format_check" CHECK (
        ("accessToken" LIKE 'v1:%' OR "accessToken" LIKE 'v2:%')
        AND ("refreshToken" IS NULL OR "refreshToken" LIKE 'v1:%' OR "refreshToken" LIKE 'v2:%')
      ) NOT VALID`;
  }
}

describe('resealIntegrationTokens', () => {
  it('rejects new plaintext writes', async () => {
    const user = await makeUser();
    userIds.push(user.id);
    await expect(
      prisma.integrationAccount.create({ data: { userId: user.id, provider: 'google', accessToken: 'plain', scopes: 'gmail.readonly' } }),
    ).rejects.toThrow();
  });

  it('seals plaintext and v1 rows as row-bound v2, and is idempotent', async () => {
    const plain = await makeUser();
    const v1 = await makeUser();
    const v2 = await makeUser();
    userIds.push(plain.id, v1.id, v2.id);
    await legacyRow(plain.id, 'legacy-access', 'legacy-refresh');
    await prisma.integrationAccount.create({
      data: { userId: v1.id, provider: 'google', accessToken: sealV1('v1-access'), refreshToken: null, scopes: 'gmail.readonly' },
    });
    const current = encryptToken('v2-access', tokenContext(v2.id, 'google', 'accessToken'));
    await prisma.integrationAccount.create({ data: { userId: v2.id, provider: 'google', accessToken: current, scopes: 'gmail.readonly' } });

    const check = await resealIntegrationTokens({ dryRun: true });
    expect(check.pending).toBeGreaterThanOrEqual(2);
    expect(check.resealed).toBe(0);

    const first = await resealIntegrationTokens();
    expect(first.resealed).toBeGreaterThanOrEqual(2);

    const rows = await prisma.integrationAccount.findMany({ where: { userId: { in: [plain.id, v1.id, v2.id] } } });
    const by = (id: string) => rows.find((r) => r.userId === id)!;
    expect(by(plain.id).accessToken.startsWith('v2:')).toBe(true);
    expect(decryptToken(by(plain.id).accessToken, tokenContext(plain.id, 'google', 'accessToken'))).toBe('legacy-access');
    expect(decryptToken(by(plain.id).refreshToken!, tokenContext(plain.id, 'google', 'refreshToken'))).toBe('legacy-refresh');
    expect(decryptToken(by(v1.id).accessToken, tokenContext(v1.id, 'google', 'accessToken'))).toBe('v1-access');
    expect(by(v2.id).accessToken).toBe(current);

    const again = await resealIntegrationTokens({ dryRun: true });
    const mine = await prisma.integrationAccount.findMany({ where: { userId: { in: [plain.id, v1.id, v2.id] } } });
    expect(mine.every((r) => r.accessToken.startsWith('v2:'))).toBe(true);
    expect(again.resealed).toBe(0);
  });
});
