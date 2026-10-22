// lib/auth/test-helpers.ts
// Shared fixtures for auth route tests that run against the real test
// database (DATABASE_URL from .env.test). Tests never truncate tables: every
// test uses unique emails and client IPs, so test files can run in parallel
// against the same database without interfering.
import { randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { hashPassword } from './password';

export const APP_ORIGIN = 'http://localhost:3000';

export function uniqueEmail(tag = 'user'): string {
  return `${tag}-${randomUUID()}@example.test`;
}

export function uniqueIp(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

export interface RequestOptions {
  method?: string;
  ip?: string;
  cookie?: string;
  origin?: string | null;
  contentType?: string | null;
  headers?: Record<string, string>;
}

export function apiRequest(path: string, body?: unknown, opts: RequestOptions = {}): Request {
  const headers = new Headers(opts.headers);
  if (opts.origin !== null) headers.set('origin', opts.origin ?? APP_ORIGIN);
  if (body !== undefined && opts.contentType !== null) headers.set('content-type', opts.contentType ?? 'application/json');
  headers.set('x-real-ip', opts.ip ?? uniqueIp());
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new Request(`${APP_ORIGIN}${path}`, {
    method: opts.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Turns Set-Cookie response headers into a Cookie request header value. */
export function cookieHeaderFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

export function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

export async function createUser(opts: {
  email?: string;
  password?: string | null;
  emailVerified?: boolean;
  googleId?: string;
  githubId?: string;
} = {}) {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password === undefined ? 'correct horse battery staple' : opts.password;
  return prisma.user.create({
    data: {
      email,
      password: password === null ? null : await hashPassword(password),
      emailVerified: opts.emailVerified ?? true,
      googleId: opts.googleId,
      githubId: opts.githubId,
    },
  });
}

export async function authEventsFor(where: { email?: string; userId?: string }) {
  return prisma.authEvent.findMany({ where, orderBy: { createdAt: 'asc' } });
}

/** Fine-grained event names recorded in AuthEvent.metadata.event. */
export async function authEventNames(where: { email?: string; userId?: string }): Promise<string[]> {
  const events = await authEventsFor(where);
  return events.map((e) => String((e.metadata as Record<string, unknown> | null)?.event ?? e.type));
}
