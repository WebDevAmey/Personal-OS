// lib/test/global-db-setup.ts — Vitest global setup: applies Prisma
// migrations to the local test database once per run (docs/09 §2.2).
//
// Refuses to touch anything but a local database whose name looks like a
// test database, so tests can never migrate Neon by accident.
import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { logger } from '../observability/logger';

export function isSafeTestDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
    const name = u.pathname.replace(/^\//, '');
    return local && /(^aios_ws\d+$)|(_test$)|(_e2e$)|(^aios_test$)/.test(name);
  } catch {
    return false;
  }
}

export default function setup(): void {
  config({ path: '.env.test', quiet: true });
  const url = process.env.DATABASE_URL;
  if (!isSafeTestDatabaseUrl(url)) {
    if (url) logger.warn('test.db_setup.skipped', { reason: 'DATABASE_URL is not a local test database' });
    return;
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
