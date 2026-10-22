// SEC-B-008 / SEC-B-017 still open (independent review, 2026-10-22).
//
// The signed-in UI (app/(app)/layout.tsx, today/page.tsx, tasks/page.tsx)
// still authenticates with legacy Auth.js `auth()`, and
// app/api/auth/[...nextauth] is still served (middleware.ts:37-44 lists its
// endpoints as public). Its Google sign-in writes plaintext OAuth tokens via
// lib/auth/persist-integration-account.ts and the Drizzle adapter. This is
// the regression test the baseline report names for SEC-B-008; it FAILS
// against the current code.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('SEC-B-008: one identity system', () => {
  it('no app/ or lib/ module imports legacy Auth.js (@/auth)', () => {
    const offenders = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))]
      .filter((f) => /from\s+['"]@\/auth['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('every page under app/(app) authenticates with requirePageUser/getSession', () => {
    const pages = walk(join(ROOT, 'app', '(app)')).filter((f) => /(page|layout)\.tsx$/.test(f));
    const missing = pages
      .filter((f) => !/\b(requirePageUser|getSession)\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(missing).toEqual([]);
  });
});
