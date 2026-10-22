// e2e/support/config.ts — ports, URLs, and the server environment for E2E
// runs. Every value here is a dummy for a local test run: no real secrets.
import { SCRIPTED_MODEL_ACK } from '@/lib/env';

export const APP_PORT = 3000;
export const PROXY_PORT = 3443;
export const INNGEST_SINK_PORT = 3999;
export const BASE_URL = `https://localhost:${PROXY_PORT}`;

export const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://aios:aios@localhost:5432/aios_ws5';

/** Environment for `next start` (production mode, so lib/env.ts's contract applies). */
export function serverEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    DATABASE_URL,
    NEXT_PUBLIC_APP_URL: BASE_URL,
    JWT_SECRET: 'e2e-jwt-secret-not-a-real-secret-0123456789',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    ANTHROPIC_API_KEY: 'e2e-dummy-never-used',
    GOOGLE_CLIENT_ID: 'e2e-dummy-client-id',
    GOOGLE_CLIENT_SECRET: 'e2e-dummy-client-secret',
    INNGEST_SIGNING_KEY: 'signkey-e2e-0000',
    INNGEST_EVENT_KEY: 'e2e-dummy-event-key',
    // Page-load enqueues go to the local sink in e2e/support/https-proxy.mjs.
    INNGEST_BASE_URL: `http://127.0.0.1:${INNGEST_SINK_PORT}`,
    RATE_LIMIT_ALLOW_MEMORY: '1',
    // Seeded users get distinct x-real-ip values; the local proxy is trusted.
    TRUST_PROXY_IP_HEADERS: '1',
    EMAIL_TRANSPORT: 'memory',
    E2E_SCRIPTED_MODEL: '1',
    E2E_ALLOW_SCRIPTED_MODEL: SCRIPTED_MODEL_ACK,
  };
}

export const PASSWORD = 'correct-horse-battery-e2e';

/** Seeded users (e2e/global-setup.ts). One per spec so specs can run in parallel. */
export const USERS = {
  morning: 'morning@e2e.test',
  bulk: 'bulk@e2e.test',
  voice: 'voice@e2e.test',
  keys: 'keys@e2e.test',
  alpha: 'alpha@e2e.test',
  beta: 'beta@e2e.test',
} as const;

export const TIME_ZONE = 'America/New_York';
