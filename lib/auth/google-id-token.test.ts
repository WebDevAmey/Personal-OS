// @vitest-environment node
// SEC-B-021: Google ID token signature + iss/aud/exp validation. Google's
// JWKS is replaced by a locally generated key set (no network).
import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { verifyGoogleIdToken } from './google-id-token';

const AUD = 'test-client-id.apps.googleusercontent.com';
let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

function token(claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: number; key?: CryptoKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: 'google-sub-1', email: 'a@example.test', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? 'https://accounts.google.com')
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt(now)
    .setExpirationTime(opts.exp ?? now + 3600)
    .sign(opts.key ?? privateKey);
}

describe('verifyGoogleIdToken (SEC-B-021)', () => {
  it('accepts a correctly signed token for our client', async () => {
    const claims = await verifyGoogleIdToken(await token({ name: 'A' }), { keys, audience: AUD });
    expect(claims).toEqual({ sub: 'google-sub-1', email: 'a@example.test', email_verified: true, name: 'A', picture: undefined });
  });

  it('accepts the bare accounts.google.com issuer', async () => {
    await expect(verifyGoogleIdToken(await token({}, { iss: 'accounts.google.com' }), { keys, audience: AUD })).resolves.toBeTruthy();
  });

  it('rejects a token issued for another client (aud)', async () => {
    await expect(verifyGoogleIdToken(await token({}, { aud: 'someone-else' }), { keys, audience: AUD })).rejects.toThrow();
  });

  it('rejects a foreign issuer', async () => {
    await expect(verifyGoogleIdToken(await token({}, { iss: 'https://evil.example' }), { keys, audience: AUD })).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    await expect(verifyGoogleIdToken(await token({}, { exp: past }), { keys, audience: AUD })).rejects.toThrow();
  });

  it('rejects a token signed by a key not in the JWKS', async () => {
    await expect(verifyGoogleIdToken(await token({}, { key: otherKey }), { keys, audience: AUD })).rejects.toThrow();
  });

  it('rejects an unsigned (decoded-only) token', async () => {
    const [h, p] = (await token()).split('.');
    await expect(verifyGoogleIdToken(`${h}.${p}.`, { keys, audience: AUD })).rejects.toThrow();
  });

  it('reports email_verified false when the claim is missing', async () => {
    const claims = await verifyGoogleIdToken(await token({ email_verified: undefined }), { keys, audience: AUD });
    expect(claims.email_verified).toBe(false);
  });

  it('requires GOOGLE_CLIENT_ID', async () => {
    await expect(verifyGoogleIdToken(await token(), { keys, audience: '' })).rejects.toThrow(/GOOGLE_CLIENT_ID/);
  });
});
