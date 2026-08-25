// @vitest-environment node
//
// jose's WebCrypto key-type checks do `instanceof Uint8Array`, and jsdom
// (this project's default vitest environment) ships its own Uint8Array
// global that isn't reference-equal to Node's, so under jsdom that check
// fails with "Received an instance of Uint8Array" even though it is one.
// Same root cause as the jsdom/WebSocket clash documented in
// lib/prisma.test.ts — forcing the Node environment for this file avoids it
// without touching the global jsdom config other tests rely on.
import { describe, it, expect } from 'vitest';
import { signSessionToken, verifySessionToken } from './jwt';

describe('session JWT', () => {
  it('round-trips a valid token', async () => {
    const token = await signSessionToken({ userId: 'user-1', sessionVersion: 0 });
    const payload = await verifySessionToken(token);
    expect(payload).toEqual({ userId: 'user-1', sessionVersion: 0 });
  });

  it('returns null for a malformed token', async () => {
    const payload = await verifySessionToken('not-a-real-token');
    expect(payload).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    const { SignJWT } = await import('jose');
    const wrongSecret = new TextEncoder().encode('a-completely-different-secret-value-32bytes');
    const forged = await new SignJWT({ userId: 'user-1', sessionVersion: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(wrongSecret);
    const payload = await verifySessionToken(forged);
    expect(payload).toBeNull();
  });
});
