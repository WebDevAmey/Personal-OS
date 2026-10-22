import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// ── ARCH-001 module boundaries (docs/02, ADR-006) ────────────────────────────
// Only repositories and auth may touch the Prisma client directly; everything
// else goes through an ownership-scoped repo (lib/**/repo.ts). The legacy
// Drizzle client (db/) is frozen and may not be imported outside db/.
const PRISMA_MESSAGE =
  "ARCH-001: import an ownership-scoped repository (lib/<domain>/repo.ts) instead of '@/lib/prisma'.";
const DRIZZLE_MESSAGE =
  "ARCH-001: the legacy Drizzle client (db/) is frozen; use the Prisma repositories in lib/<domain>/repo.ts.";

const banPrisma = {
  name: "@/lib/prisma",
  message: PRISMA_MESSAGE,
};
const banDrizzlePatterns = [
  { group: ["@/db", "@/db/*", "**/db/client", "**/db/schema", "**/db/schema/*"], message: DRIZZLE_MESSAGE },
];

const restrictAll = { paths: [banPrisma], patterns: banDrizzlePatterns };
const restrictDrizzleOnly = { patterns: banDrizzlePatterns };

// Files allowed to import '@/lib/prisma'.
const PRISMA_ALLOWED = [
  "lib/prisma.ts",
  "lib/**/repo.ts",
  "lib/**/repo/**",
  "lib/db/**",
  "lib/auth/**",
  "app/api/auth/**",
  "lib/audit/**",
  "lib/test/**",
  "scripts/**",
  "**/*.test.ts",
  "**/*.test.tsx",
];

// Existing violators outside WS-1 ownership: downgraded to warnings until
// their owners move them onto repositories. Remove entries as they are fixed.
const PRISMA_WARN = ["lib/integrations/google/refresh-token.ts", "lib/security/auth-rate-limit.ts"];
const DRIZZLE_WARN = [
  "app/(app)/today/page.tsx",
  "auth.ts",
  "components/briefing/briefing-view.tsx",
  "components/tasks/task-list.tsx",
  "lib/ai/idempotency.ts",
  "lib/ai/idempotency.test.ts",
  "lib/ai/orchestrator.ts",
  "lib/ai/orchestrator.test.ts",
];
// In a Prisma-allowed location, so only the Drizzle import is downgraded.
const DRIZZLE_WARN_PRISMA_ALLOWED = [
  "lib/auth/persist-integration-account.ts",
  "lib/auth/persist-integration-account.test.ts",
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "lib/generated/**",
      ".claude/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: { "no-restricted-imports": ["error", restrictAll] },
  },
  {
    files: PRISMA_ALLOWED,
    rules: { "no-restricted-imports": ["error", restrictDrizzleOnly] },
  },
  {
    files: ["db/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: PRISMA_WARN,
    rules: { "no-restricted-imports": ["warn", restrictAll] },
  },
  {
    files: DRIZZLE_WARN,
    rules: { "no-restricted-imports": ["warn", restrictAll] },
  },
  {
    files: DRIZZLE_WARN_PRISMA_ALLOWED,
    rules: { "no-restricted-imports": ["warn", restrictDrizzleOnly] },
  },
];

export default eslintConfig;
