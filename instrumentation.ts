// instrumentation.ts — runs once when a Next.js server instance boots.
// Production refuses to start with a missing or malformed server environment
// (lib/env.ts, SEC-R-010) instead of failing at first use.
export async function register(): Promise<void> {
  // Only the Node.js server runtime; `next build` does not boot a server.
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { assertServerEnv } = await import('./lib/env');
  assertServerEnv();
}
