// @vitest-environment node
// SEC-B-004 regression: passkey sign-in options disclose no credential ids,
// are per-IP rate limited, and bind the challenge to the browser.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { apiRequest, createUser, uniqueIp } from '@/lib/auth/test-helpers';
import { POST } from './route';

const call = (ip = uniqueIp()) => POST(apiRequest('/api/auth/passkey/auth/options', undefined, { ip }));

describe('POST /api/auth/passkey/auth/options', () => {
  it('returns no allowCredentials even when passkeys exist (discoverable login)', async () => {
    const user = await createUser();
    await prisma.passkeyCredential.create({
      data: { id: `cred-${randomUUID()}`, userId: user.id, publicKey: Buffer.from([1]), transports: ['internal'], deviceType: 'singleDevice' },
    });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowCredentials ?? []).toEqual([]);
    expect(body.userVerification).toBe('required');
  });

  it('stores an unowned challenge and binds it with an HttpOnly cookie holding the row id', async () => {
    const res = await call();
    const body = await res.json();
    const [cookie] = res.headers.getSetCookie();
    expect(cookie).toMatch(/^pk_chal=[\w-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=300');
    const id = cookie.split(';')[0].split('=')[1];
    const row = await prisma.webAuthnChallenge.findUniqueOrThrow({ where: { id } });
    expect(row.userId).toBeNull();
    expect(row.challenge).toBe(body.challenge);
  });

  it('returns 429 on the 11th call per minute from one IP', async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call(ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('sweeps expired challenge rows', async () => {
    const stale = await prisma.webAuthnChallenge.create({ data: { challenge: `old-${randomUUID()}`, expiresAt: new Date(Date.now() - 1000) } });
    await call();
    expect(await prisma.webAuthnChallenge.findUnique({ where: { id: stale.id } })).toBeNull();
  });
});
