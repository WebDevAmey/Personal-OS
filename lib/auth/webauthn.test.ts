// lib/auth/webauthn.test.ts
import { describe, it, expect } from 'vitest';
import { RP_ID, RP_NAME, ORIGIN } from './webauthn';

describe('webauthn config', () => {
  it('derives RP_ID from NEXT_PUBLIC_APP_URL without a protocol or port', () => {
    expect(RP_ID).toBe('localhost');
    expect(ORIGIN).toBe('http://localhost:3000');
    expect(RP_NAME).toBe('Personal OS');
  });
});
