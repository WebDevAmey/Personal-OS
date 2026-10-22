import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

// ARCH-001: eslint.config.mjs restricts who may import '@/lib/prisma' and bans
// the legacy Drizzle client outside db/. Lints virtual files at chosen paths.
const eslint = new ESLint({ cwd: process.cwd() });

async function restricted(filePath: string, code: string): Promise<{ errors: number; warnings: number }> {
  const [res] = await eslint.lintText(code, { filePath });
  const msgs = res.messages.filter((m) => m.ruleId === 'no-restricted-imports');
  return { errors: msgs.filter((m) => m.severity === 2).length, warnings: msgs.filter((m) => m.severity === 1).length };
}

const PRISMA = "import { prisma } from '@/lib/prisma';\nexport const x = prisma;\n";
const DRIZZLE = "import { db } from '@/db/client';\nexport const x = db;\n";

describe('ARCH-001 import boundaries', { timeout: 60_000 }, () => {
  it.each(['app/api/tasks/route.ts', 'components/tasks/new-widget.tsx', 'lib/ai/tools/new-tool.ts', 'inngest/new-job.ts', 'lib/tasks/queries.ts'])(
    'rejects @/lib/prisma in %s',
    async (p) => expect((await restricted(p, PRISMA)).errors).toBe(1),
  );

  it.each(['lib/tasks/repo.ts', 'lib/tasks/repo/core.ts', 'lib/projects/repo.ts', 'lib/auth/session.ts', 'app/api/auth/login/route.ts', 'lib/audit/x.ts', 'scripts/db-integrity.ts', 'lib/ai/x.test.ts'])(
    'allows @/lib/prisma in %s',
    async (p) => expect(await restricted(p, PRISMA)).toEqual({ errors: 0, warnings: 0 }),
  );

  it.each(['lib/tasks/repo.ts', 'lib/auth/new.ts', 'app/api/x/route.ts', 'lib/x.test.ts'])('rejects @/db/* in %s', async (p) =>
    expect((await restricted(p, DRIZZLE)).errors).toBe(1),
  );

  it('allows the Drizzle client inside db/', async () => {
    expect(await restricted('db/other.ts', DRIZZLE)).toEqual({ errors: 0, warnings: 0 });
  });

  it('only warns for the listed pre-existing violators', async () => {
    expect(await restricted('lib/ai/orchestrator.ts', DRIZZLE)).toEqual({ errors: 0, warnings: 1 });
    expect(await restricted('lib/integrations/google/refresh-token.ts', PRISMA)).toEqual({ errors: 0, warnings: 1 });
  });
});
