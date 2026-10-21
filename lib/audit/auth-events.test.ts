// @vitest-environment node
// AuthEvent writes (ADR-012, SEC-B-025) against the real test database.
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { recordAuthEvent, storedAuthEventType } from './auth-events';
import { createUser, uniqueEmail } from '@/lib/auth/test-helpers';

describe('recordAuthEvent', () => {
  it('stores type, user, normalised email, ip, user agent and metadata', async () => {
    const user = await createUser();
    const email = uniqueEmail('Audit').toUpperCase();
    const req = new Request('http://localhost:3000/api/auth/login', {
      headers: { 'x-real-ip': '203.0.113.9', 'user-agent': 'vitest', 'x-request-id': '7b4c1c1e-1d43-4c26-9a51-0a5c8f1c2e11' },
    });
    await recordAuthEvent({ event: 'LOGIN_SUCCESS', req, userId: user.id, email, metadata: { method: 'password' } });
    const [row] = await prisma.authEvent.findMany({ where: { userId: user.id } });
    expect(row).toMatchObject({
      type: 'LOGIN_SUCCESS',
      email: email.toLowerCase(),
      ip: '203.0.113.9',
      userAgent: 'vitest',
    });
    expect(row.metadata).toEqual({ event: 'LOGIN_SUCCESS', method: 'password', requestId: '7b4c1c1e-1d43-4c26-9a51-0a5c8f1c2e11' });
  });

  it('maps fine-grained events onto the existing enum and keeps the name in metadata', async () => {
    const email = uniqueEmail();
    await recordAuthEvent({ event: 'LOGIN_RATE_LIMITED', email });
    const [row] = await prisma.authEvent.findMany({ where: { email } });
    expect(row.type).toBe(storedAuthEventType('LOGIN_RATE_LIMITED'));
    expect((row.metadata as { event: string }).event).toBe('LOGIN_RATE_LIMITED');
  });

  it('redacts secret-looking metadata keys and token-shaped values', async () => {
    const email = uniqueEmail();
    await recordAuthEvent({
      event: 'LOGIN_FAILURE',
      email,
      metadata: { password: 'hunter2hunter2', reason: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk' },
    });
    const [row] = await prisma.authEvent.findMany({ where: { email } });
    const text = JSON.stringify(row.metadata);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('eyJhbGci');
  });

  it('never throws when the write fails (unknown userId violates the FK)', async () => {
    await expect(recordAuthEvent({ event: 'LOGOUT', userId: 'does-not-exist' })).resolves.toBeUndefined();
  });
});
