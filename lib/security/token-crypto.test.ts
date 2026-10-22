// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { encryptToken, decryptToken, isEncryptedToken, needsReseal, tokenContext } from './token-crypto';

const ctx = tokenContext('user-1', 'google', 'accessToken');

/** A v1 value as written before row binding: no associated data. */
function sealV1(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

describe('token crypto', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips a token in the v2 format', () => {
    const sealed = encryptToken('ya29.secret-access-token', ctx);
    expect(sealed.startsWith('v2:')).toBe(true);
    expect(isEncryptedToken(sealed)).toBe(true);
    expect(needsReseal(sealed)).toBe(false);
    expect(sealed).not.toContain('secret');
    expect(decryptToken(sealed, ctx)).toBe('ya29.secret-access-token');
  });

  it('binds the value to its row and column', () => {
    const sealed = encryptToken('ya29.secret', ctx);
    expect(() => decryptToken(sealed, tokenContext('user-2', 'google', 'accessToken'))).toThrow();
    expect(() => decryptToken(sealed, tokenContext('user-1', 'google', 'refreshToken'))).toThrow();
  });

  it('still reads v1 values, and flags them and plaintext for reseal', () => {
    const v1 = sealV1('legacy-token');
    expect(isEncryptedToken(v1)).toBe(true);
    expect(decryptToken(v1, ctx)).toBe('legacy-token');
    expect(needsReseal(v1)).toBe(true);
    expect(needsReseal('plain-token')).toBe(true);
  });

  it('uses a fresh IV per encryption', () => {
    expect(encryptToken('same', ctx)).not.toBe(encryptToken('same', ctx));
  });

  it('rejects tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptToken('value', ctx).split(':');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => decryptToken([v, iv, tag, flipped.toString('base64url')].join(':'), ctx)).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptToken('x', ctx)).toThrow(/32 bytes/);
  });

  it('refuses to decrypt plaintext', () => {
    expect(() => decryptToken('plain-token', ctx)).toThrow();
  });
});
