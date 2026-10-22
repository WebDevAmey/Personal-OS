// playwright.config.ts — browser E2E against the production build
// (`next build` then `next start`, docs/09 §2 and §6.2).
//
//   pnpm test:e2e            build with the E2E origin baked in, then run
//   pnpm test:e2e:run        run against an existing E2E build
//
// The app is served at https://localhost:3443 through e2e/support/https-proxy.mjs
// so production cookie (__Host-, Secure) and CSRF origin rules apply unchanged.
import { defineConfig, devices } from '@playwright/test';
import { APP_PORT, BASE_URL, DATABASE_URL, INNGEST_SINK_PORT, PROXY_PORT, serverEnv } from './e2e/support/config';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
process.env.DATABASE_URL = DATABASE_URL;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm start',
      url: `http://127.0.0.1:${APP_PORT}/sign-in`,
      env: serverEnv(),
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node e2e/support/https-proxy.mjs',
      url: `${BASE_URL}/sign-in`,
      ignoreHTTPSErrors: true,
      env: { PROXY_PORT: String(PROXY_PORT), APP_PORT: String(APP_PORT), INNGEST_SINK_PORT: String(INNGEST_SINK_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
