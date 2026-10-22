// lib/env.ts — server environment contract (SEC-R-010, T-SUPPLY-06).
//
// In production the server refuses to boot when a required variable is
// missing or malformed, instead of failing at first use (instrumentation.ts
// calls assertServerEnv() from register()). Error messages name the variable
// and the rule only; values are never echoed.
import { z } from 'zod';

const required = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, { error: `${name} is required` });

const optional = z.string().trim().optional();

function decodesTo32Bytes(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').length === 32;
}

const ProductionEnvSchema = z
  .object({
    DATABASE_URL: required('DATABASE_URL').refine((v) => /^postgres(ql)?:\/\//.test(v), {
      error: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),
    JWT_SECRET: required('JWT_SECRET').min(32, { error: 'JWT_SECRET must be at least 32 characters long' }),
    JWT_SECRET_PREVIOUS: optional.refine((v) => !v || v.length >= 32, {
      error: 'JWT_SECRET_PREVIOUS must be at least 32 characters long when set',
    }),
    TOKEN_ENCRYPTION_KEY: required('TOKEN_ENCRYPTION_KEY').refine(decodesTo32Bytes, {
      error: 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)',
    }),
    NEXT_PUBLIC_APP_URL: required('NEXT_PUBLIC_APP_URL').refine((v) => /^https:\/\/[^/\s]+/.test(v), {
      error: 'NEXT_PUBLIC_APP_URL must be the https:// URL of this deployment',
    }),
    ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
    GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
    GITHUB_CLIENT_ID: optional,
    GITHUB_CLIENT_SECRET: optional,
    INNGEST_SIGNING_KEY: required('INNGEST_SIGNING_KEY'),
    INNGEST_EVENT_KEY: required('INNGEST_EVENT_KEY'),
    INNGEST_DEV: optional.refine((v) => !v, {
      error: 'INNGEST_DEV must not be set in production: it disables Inngest request signing',
    }),
    UPSTASH_REDIS_REST_URL: optional,
    UPSTASH_REDIS_REST_TOKEN: optional,
    RATE_LIMIT_ALLOW_MEMORY: optional.refine((v) => !v || v === '1', { error: 'RATE_LIMIT_ALLOW_MEMORY must be 1 or unset' }),
    COMMAND_DAILY_LIMIT: optional.refine((v) => !v || /^[1-9]\d*$/.test(v), {
      error: 'COMMAND_DAILY_LIMIT must be a positive integer',
    }),
    EMAIL_TRANSPORT: optional.refine((v) => !v || v === 'resend' || v === 'memory', {
      error: 'EMAIL_TRANSPORT must be resend or memory',
    }),
    RESEND_API_KEY: optional,
  })
  .superRefine((env, ctx) => {
    const upstash = Boolean(env.UPSTASH_REDIS_REST_URL) && Boolean(env.UPSTASH_REDIS_REST_TOKEN);
    if (!upstash && env.RATE_LIMIT_ALLOW_MEMORY !== '1') {
      ctx.addIssue({
        code: 'custom',
        path: ['UPSTASH_REDIS_REST_URL'],
        message:
          'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required (or set RATE_LIMIT_ALLOW_MEMORY=1 to accept the per-instance limiter)',
      });
    }
    if (env.EMAIL_TRANSPORT !== 'memory' && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required to send sign-in emails' });
    }
    if (Boolean(env.GITHUB_CLIENT_ID) !== Boolean(env.GITHUB_CLIENT_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['GITHUB_CLIENT_ID'], message: 'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together' });
    }
  });

export type EnvCheck = { ok: true } | { ok: false; issues: string[] };

type Env = Record<string, string | undefined>;

/** Checks `env` against the production contract. Messages never contain values. */
export function checkProductionEnv(env: Env = process.env): EnvCheck {
  const result = ProductionEnvSchema.safeParse(env);
  if (result.success) return { ok: true };
  const issues = [...new Set(result.error.issues.map((i) => i.message))];
  return { ok: false, issues };
}

// ───────────── E2E scripted model (test-only seam, lib/ai/scripted-model.ts) ─────────────

/** The second variable a test run must set, verbatim, to enable the scripted model. */
export const SCRIPTED_MODEL_ACK = 'i-understand-this-is-not-production';

/** A real production deployment, as opposed to a local `next start` (which also runs with NODE_ENV=production). */
export function isProductionDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'production' || (env.NODE_ENV === 'production' && env.VERCEL === '1');
}

/**
 * True only when both E2E variables are set exactly and this is not a
 * production deployment. getLanguageModel() returns the scripted model only
 * when this holds.
 */
export function scriptedModelAllowed(env: Env = process.env): boolean {
  return env.E2E_SCRIPTED_MODEL === '1' && env.E2E_ALLOW_SCRIPTED_MODEL === SCRIPTED_MODEL_ACK && !isProductionDeployment(env);
}

/**
 * Throws with every problem listed when NODE_ENV is production and the
 * contract is not met. Outside production it does nothing: dev and test use
 * fallbacks (memory email, memory rate limiter) on purpose. A production
 * deployment with the E2E scripted-model flag set never boots.
 */
export function assertServerEnv(env: Env = process.env): void {
  if (env.E2E_SCRIPTED_MODEL !== undefined && isProductionDeployment(env)) {
    throw new Error('Invalid server environment:\n  - E2E_SCRIPTED_MODEL must not be set on a production deployment');
  }
  if (env.NODE_ENV !== 'production') return;
  const check = checkProductionEnv(env);
  if (check.ok) return;
  throw new Error(`Invalid server environment:\n${check.issues.map((i) => `  - ${i}`).join('\n')}`);
}
