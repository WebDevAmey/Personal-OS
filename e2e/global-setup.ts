// e2e/global-setup.ts — migrates and seeds the E2E database and runs the
// 08:00 briefing jobs before any spec (see e2e/support/prepare-db.ts).
import { execFileSync } from 'node:child_process';
import { DATABASE_URL } from './support/config';

export default function globalSetup(): void {
  execFileSync('pnpm', ['exec', 'tsx', 'e2e/support/prepare-db.ts'], {
    env: { ...process.env, DATABASE_URL, NODE_ENV: 'test' },
    stdio: 'inherit',
    timeout: 120_000,
  });
}
