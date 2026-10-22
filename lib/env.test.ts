// lib/env.ts: production env contract (SEC-R-010).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertServerEnv, checkProductionEnv } from './env';

const VALID = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.example/app',
  JWT_SECRET: 'j'.repeat(40),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  NEXT_PUBLIC_APP_URL: 'https://app.example',
  ANTHROPIC_API_KEY: 'test-anthropic',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  INNGEST_SIGNING_KEY: 'signkey-test',
  INNGEST_EVENT_KEY: 'eventkey-test',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.test',
  UPSTASH_REDIS_REST_TOKEN: 'upstash-test',
  RESEND_API_KEY: 'resend-test',
};

function issues(env: Record<string, string | undefined>): string[] {
  const r = checkProductionEnv(env);
  return r.ok ? [] : r.issues;
}

describe('checkProductionEnv', () => {
  it('accepts a complete production environment', () => {
    expect(checkProductionEnv(VALID)).toEqual({ ok: true });
  });

  it.each([
    'DATABASE_URL',
    'JWT_SECRET',
    'TOKEN_ENCRYPTION_KEY',
    'NEXT_PUBLIC_APP_URL',
    'ANTHROPIC_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'INNGEST_SIGNING_KEY',
    'INNGEST_EVENT_KEY',
  ])('names %s when it is missing or blank', (name) => {
    expect(issues({ ...VALID, [name]: undefined })).toContain(`${name} is required`);
    expect(issues({ ...VALID, [name]: '   ' }).join('\n')).toContain(name);
  });

  it('rejects malformed values with a clear rule', () => {
    expect(issues({ ...VALID, JWT_SECRET: 'short' })).toEqual(['JWT_SECRET must be at least 32 characters long']);
    expect(issues({ ...VALID, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })[0]).toMatch(/TOKEN_ENCRYPTION_KEY must be 32 bytes/);
    expect(issues({ ...VALID, TOKEN_ENCRYPTION_KEY: 'not base64 at all!' })[0]).toMatch(/TOKEN_ENCRYPTION_KEY/);
    expect(issues({ ...VALID, NEXT_PUBLIC_APP_URL: 'http://app.example' })[0]).toMatch(/https/);
    expect(issues({ ...VALID, DATABASE_URL: 'mysql://x' })[0]).toMatch(/postgres/);
    expect(issues({ ...VALID, COMMAND_DAILY_LIMIT: '0' })[0]).toMatch(/COMMAND_DAILY_LIMIT/);
    expect(issues({ ...VALID, JWT_SECRET_PREVIOUS: 'short' })[0]).toMatch(/JWT_SECRET_PREVIOUS/);
  });

  it('forbids INNGEST_DEV in production', () => {
    expect(issues({ ...VALID, INNGEST_DEV: '1' })[0]).toMatch(/INNGEST_DEV must not be set/);
  });

  it('requires Upstash unless RATE_LIMIT_ALLOW_MEMORY=1', () => {
    const noUpstash = { ...VALID, UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: '' };
    expect(issues(noUpstash)[0]).toMatch(/UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required/);
    expect(checkProductionEnv({ ...noUpstash, RATE_LIMIT_ALLOW_MEMORY: '1' })).toEqual({ ok: true });
    expect(issues({ ...noUpstash, RATE_LIMIT_ALLOW_MEMORY: 'yes' }).length).toBeGreaterThan(0);
  });

  it('requires RESEND_API_KEY unless email goes to the memory transport', () => {
    expect(issues({ ...VALID, RESEND_API_KEY: undefined })).toEqual(['RESEND_API_KEY is required to send sign-in emails']);
    expect(checkProductionEnv({ ...VALID, RESEND_API_KEY: undefined, EMAIL_TRANSPORT: 'memory' })).toEqual({ ok: true });
  });

  it('requires the GitHub OAuth pair together', () => {
    expect(issues({ ...VALID, GITHUB_CLIENT_ID: 'x' })[0]).toMatch(/GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET/);
    expect(checkProductionEnv({ ...VALID, GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y' })).toEqual({ ok: true });
  });

  it('never echoes a value in its messages', () => {
    const secret = 'super-secret-value-that-is-too-short';
    const out = issues({ ...VALID, JWT_SECRET: 'tiny-secret', TOKEN_ENCRYPTION_KEY: secret, INNGEST_DEV: secret });
    expect(out.join('\n')).not.toContain(secret);
    expect(out.join('\n')).not.toContain('tiny-secret');
  });
});

describe('assertServerEnv', () => {
  it('throws in production, listing every problem', () => {
    expect(() => assertServerEnv({ ...VALID, JWT_SECRET: undefined, INNGEST_SIGNING_KEY: undefined })).toThrow(
      /Invalid server environment:\n {2}- JWT_SECRET is required\n {2}- INNGEST_SIGNING_KEY is required/,
    );
  });

  it('passes a valid production env and does nothing outside production', () => {
    expect(() => assertServerEnv(VALID)).not.toThrow();
    expect(() => assertServerEnv({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertServerEnv({ NODE_ENV: 'test' })).not.toThrow();
  });
});

describe('instrumentation register()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails the production boot of the Node.js server on an invalid env', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('INNGEST_SIGNING_KEY', '');
    const { register } = await import('@/instrumentation');
    await expect(register()).rejects.toThrow(/Invalid server environment/);
  });

  it('skips the edge runtime and the build phase', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INNGEST_SIGNING_KEY', '');
    const { register } = await import('@/instrumentation');
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await expect(register()).resolves.toBeUndefined();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    await expect(register()).resolves.toBeUndefined();
  });

  it('boots in development without production secrets', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
  });
});
