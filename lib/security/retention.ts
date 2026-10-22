// lib/security/retention.ts
// Retention purge for the security tables (docs/03 §6, SEC-R-012). Run daily
// by inngest/retention.ts.
//
// | Table             | Rule                                   |
// |-------------------|----------------------------------------|
// | RateLimitAttempt  | windowStart < now − 24 h               |
// | AuthEvent         | createdAt < now − 1 year               |
// | WebAuthnChallenge | expiresAt < now − 1 h                  |
// | VerificationToken | expiresAt < now − 24 h                 |
// | AgentRun          | createdAt < now − 90 days (cascades its |
// |                   | proposals and actions; TaskEvent keeps  |
// |                   | its history with the run id nulled)     |
//
// Rows are deleted in batches of RETENTION_BATCH by primary key, each batch
// its own statement, so a large backlog never holds one long lock.
import { deleteRowsBefore } from './repo';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const RETENTION = {
  rateLimitAttemptMs: DAY_MS,
  authEventMs: 365 * DAY_MS,
  webAuthnChallengeGraceMs: HOUR_MS,
  verificationTokenGraceMs: DAY_MS,
  agentRunMs: 90 * DAY_MS,
} as const;

export const RETENTION_BATCH = 1000;

export interface RetentionResult {
  rateLimitAttempts: number;
  authEvents: number;
  webAuthnChallenges: number;
  verificationTokens: number;
  agentRuns: number;
}

export async function purgeSecurityTables(opts: { now?: Date; batch?: number } = {}): Promise<RetentionResult> {
  const now = (opts.now ?? new Date()).getTime();
  const batch = opts.batch ?? RETENTION_BATCH;
  const before = (ms: number) => new Date(now - ms);
  return {
    rateLimitAttempts: await deleteRowsBefore('RateLimitAttempt', before(RETENTION.rateLimitAttemptMs), batch),
    authEvents: await deleteRowsBefore('AuthEvent', before(RETENTION.authEventMs), batch),
    webAuthnChallenges: await deleteRowsBefore('WebAuthnChallenge', before(RETENTION.webAuthnChallengeGraceMs), batch),
    verificationTokens: await deleteRowsBefore('VerificationToken', before(RETENTION.verificationTokenGraceMs), batch),
    agentRuns: await deleteRowsBefore('AgentRun', before(RETENTION.agentRunMs), batch),
  };
}
