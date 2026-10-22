import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';

// Three projects (docs/09 §2.1):
//  - unit:        *.test.ts in node (the default; avoids jsdom/Neon `Event` clashes)
//  - dom:         *.test.tsx in jsdom (React components)
//  - integration: *.int.test.ts against the local Postgres in DATABASE_URL,
//                 one file at a time so fixtures and timing tests don't interfere
// The global setup migrates the local test database once per run.
const exclude = ['**/node_modules/**', '**/.next/**', 'e2e/**', '.claude/**', '.worktrees/**'];

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: true,
    setupFiles: ['./lib/test/setup.ts'],
    globalSetup: ['./lib/test/global-db-setup.ts'],
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['**/*.test.ts'], exclude: [...exclude, '**/*.int.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: ['**/*.test.tsx'], exclude },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['**/*.int.test.ts'],
          exclude,
          pool: 'forks',
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
