// lib/auth/webauthn.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RP_ID, RP_NAME, ORIGIN, userIdToUserHandle } from './webauthn';

describe('webauthn config', () => {
  it('derives RP_ID from NEXT_PUBLIC_APP_URL without a protocol or port', () => {
    expect(RP_ID).toBe('localhost');
    expect(ORIGIN).toBe('http://localhost:3000');
    expect(RP_NAME).toBe('Personal OS');
  });
});

describe('webauthn config module-load fail-fast', () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = original;
    vi.resetModules();
  });

  // Without this, `new URL(undefined)` throws a cryptic "TypeError: Invalid
  // URL" instead of naming the missing env var -- and on a fresh clone, CI
  // runner, or Vercel deploy without a local .env file, this is the ONLY
  // signal a misconfigured deploy gets.
  it('throws a clear error at module load when NEXT_PUBLIC_APP_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.resetModules();
    await expect(import('./webauthn')).rejects.toThrow('NEXT_PUBLIC_APP_URL');
  });

  // .env.example ships NEXT_PUBLIC_APP_URL as present-but-empty in some
  // states -- an empty string must fail the same way as unset, since
  // `new URL('')` throws the identical opaque error.
  it('throws a clear error at module load when NEXT_PUBLIC_APP_URL is empty', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '';
    vi.resetModules();
    await expect(import('./webauthn')).rejects.toThrow('NEXT_PUBLIC_APP_URL');
  });
});

describe('userIdToUserHandle', () => {
  it('derives the same bytes for the same user id', () => {
    expect(userIdToUserHandle('user-1')).toEqual(userIdToUserHandle('user-1'));
  });

  it('derives different bytes for different user ids', () => {
    expect(userIdToUserHandle('user-1')).not.toEqual(userIdToUserHandle('user-2'));
  });
});
