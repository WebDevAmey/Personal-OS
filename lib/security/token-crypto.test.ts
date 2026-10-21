// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptToken, decryptToken, isEncryptedToken } from './token-crypto';

describe('token crypto', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips a token', () => {
    const sealed = encryptToken('ya29.secret-access-token');
    expect(isEncryptedToken(sealed)).toBe(true);
    expect(sealed).not.toContain('secret');
    expect(decryptToken(sealed)).toBe('ya29.secret-access-token');
  });

  it('uses a fresh IV per encryption', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'));
  });

  it('rejects tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptToken('value').split(':');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => decryptToken([v, iv, tag, flipped.toString('base64url')].join(':'))).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptToken('x')).toThrow(/32 bytes/);
  });

  it('refuses to decrypt plaintext', () => {
    expect(() => decryptToken('plain-token')).toThrow();
  });
});
