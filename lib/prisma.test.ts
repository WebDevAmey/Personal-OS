// @vitest-environment node
//
// The Neon serverless driver used by the Prisma driver adapter opens a real
// WebSocket connection. jsdom (this project's default vitest environment,
// needed for React component tests) ships its own `Event`/`WebSocket`
// globals that are incompatible with Node's real ones, so under jsdom this
// test hangs/throws `TypeError: The "event" argument must be an instance of
// Event. Received an instance of Event`. Forcing the Node environment for
// this file avoids the clash without touching the global jsdom config other
// tests rely on.
import { describe, it, expect } from 'vitest';
import { prisma } from './prisma';

describe('prisma client', () => {
  it('connects and can run a trivial query', async () => {
    const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
    expect(result[0].ok).toBe(1);
  });

  it('exposes every model this project needs', () => {
    expect(prisma.user).toBeDefined();
    expect(prisma.passkeyCredential).toBeDefined();
    expect(prisma.webAuthnChallenge).toBeDefined();
    expect(prisma.verificationToken).toBeDefined();
    expect(prisma.rateLimitAttempt).toBeDefined();
    expect(prisma.authEvent).toBeDefined();
    expect(prisma.integrationAccount).toBeDefined();
    expect(prisma.task).toBeDefined();
    expect(prisma.memory).toBeDefined();
    expect(prisma.dailyBriefing).toBeDefined();
    expect(prisma.agentRun).toBeDefined();
    expect(prisma.agentAction).toBeDefined();
  });
});
