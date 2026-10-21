// SEC-B-022: password policy.
import { describe, it, expect } from 'vitest';
import { LoginPasswordSchema, NewPasswordSchema, SALT_ROUNDS, hashPassword } from './password';

describe('NewPasswordSchema (SEC-B-022)', () => {
  it('requires at least 12 characters', () => {
    expect(NewPasswordSchema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(NewPasswordSchema.safeParse('a'.repeat(12)).success).toBe(true);
  });

  it('rejects more than 72 UTF-8 bytes (bcrypt would silently truncate)', () => {
    expect(NewPasswordSchema.safeParse('a'.repeat(72)).success).toBe(true);
    expect(NewPasswordSchema.safeParse('a'.repeat(73)).success).toBe(false);
    // 25 three-byte characters = 75 bytes but only 25 characters.
    expect(NewPasswordSchema.safeParse('€'.repeat(25)).success).toBe(false);
  });

  it('bounds what sign-in will hash', () => {
    expect(LoginPasswordSchema.safeParse('x'.repeat(1025)).success).toBe(false);
    expect(LoginPasswordSchema.safeParse('').success).toBe(false);
  });

  it('hashes with bcrypt cost 12', async () => {
    expect(SALT_ROUNDS).toBe(12);
    expect(await hashPassword('correct horse battery staple')).toMatch(/^\$2[aby]\$12\$/);
  });
});
