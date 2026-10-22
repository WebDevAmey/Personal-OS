// lib/security/token-crypto.ts
// AES-256-GCM encryption for OAuth credentials at rest (ADR-011).
//
//   v2:<iv b64url>:<tag b64url>:<ciphertext b64url>   written today
//   v1:<iv b64url>:<tag b64url>:<ciphertext b64url>   read only (no AAD)
//
// v2 binds each value to its row with associated data `userId:provider:column`
// (tokenContext), so a ciphertext copied into another user's row fails to
// decrypt (SEC-R-009). scripts/encrypt-integration-tokens.ts reseals v1 and
// legacy plaintext rows as v2.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const CURRENT = 'v2';
const IV_BYTES = 12;

export type TokenColumn = 'accessToken' | 'refreshToken';

/** Associated data that binds a sealed token to its IntegrationAccount row and column. */
export function tokenContext(userId: string, provider: string, column: TokenColumn): string {
  return `${userId}:${provider}:${column}`;
}

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY must be set');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return buf;
}

export function encryptToken(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CURRENT, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function isEncryptedToken(value: string): boolean {
  return /^v[12]:/.test(value) && value.split(':').length === 4;
}

/** True when the value is not yet in the current format (plaintext or v1). */
export function needsReseal(value: string): boolean {
  return !(value.startsWith(`${CURRENT}:`) && isEncryptedToken(value));
}

export function decryptToken(value: string, context: string): string {
  if (!isEncryptedToken(value)) throw new Error('Value is not an encrypted token');
  const [version, iv, tag, ciphertext] = value.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  if (version === CURRENT) decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
