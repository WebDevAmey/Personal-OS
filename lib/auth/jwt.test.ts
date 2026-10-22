// @vitest-environment node
//
// jose's WebCrypto key-type checks do `instanceof Uint8Array`, and jsdom
// ships its own Uint8Array global, so this file runs in the Node environment.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SignJWT } from 'jose';
import { JWT_AUDIENCE, JWT_ISSUER, signSessionToken, verifySessionToken } from './jwt';

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET);

afterEach(() => vi.unstubAllEnvs());

describe('session JWT', () => {
  it('round-trips a valid token with iss/aud/exp', async () => {
    const token = await signSessionToken({ userId: 'user-1', sessionVersion: 0 });
    expect(await verifySessionToken(token)).toEqual({ userId: 'user-1', sessionVersion: 0 });
    const [, body] = token.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(claims.iss).toBe(JWT_ISSUER);
    expect(claims.aud).toBe(JWT_AUDIENCE);
    expect(claims.exp - claims.iat).toBe(30 * 24 * 60 * 60);
  });

  it('returns null for a malformed token', async () => {
    expect(await verifySessionToken('not-a-real-token')).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    const wrongSecret = new TextEncoder().encode('a-completely-different-secret-value-32bytes');
    const forged = await new SignJWT({ userId: 'user-1', sessionVersion: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(wrongSecret);
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it('rejects alg:none', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(
      JSON.stringify({ userId: 'user-1', sessionVersion: 0, iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: now, exp: now + 60 }),
    ).toString('base64url');
    expect(await verifySessionToken(`${header}.${body}.`)).toBeNull();
  });

  it('rejects HS512 even with the right secret (algorithm pinned)', async () => {
    const token = await new SignJWT({ userId: 'user-1', sessionVersion: 0 })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret());
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects a token without the expected issuer or audience', async () => {
    const base = () =>
      new SignJWT({ userId: 'user-1', sessionVersion: 0 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h');
    expect(await verifySessionToken(await base().sign(secret()))).toBeNull();
    expect(await verifySessionToken(await base().setIssuer(JWT_ISSUER).setAudience('other').sign(secret()))).toBeNull();
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ userId: 'user-1', sessionVersion: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(secret());
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('accepts tokens signed with JWT_SECRET_PREVIOUS during rotation, and signs with the current secret', async () => {
    const old = 'the-previous-secret-value-at-least-32-chars';
    vi.stubEnv('JWT_SECRET', old);
    const legacy = await signSessionToken({ userId: 'user-1', sessionVersion: 3 });
    vi.stubEnv('JWT_SECRET', 'the-brand-new-secret-value-at-least-32-chars');
    expect(await verifySessionToken(legacy)).toBeNull();
    vi.stubEnv('JWT_SECRET_PREVIOUS', old);
    expect(await verifySessionToken(legacy)).toEqual({ userId: 'user-1', sessionVersion: 3 });
  });

  it('fails loudly on a short secret', async () => {
    vi.stubEnv('JWT_SECRET', 'short');
    await expect(signSessionToken({ userId: 'u', sessionVersion: 0 })).rejects.toThrow(/32 characters/);
  });
});
