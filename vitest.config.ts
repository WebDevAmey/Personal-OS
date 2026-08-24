import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./lib/test/setup.ts'],
    passWithNoTests: true,
    // Multiple test files share one live Neon Postgres DB and truncate
    // shared tables (e.g. `users`) in beforeEach. Running files in
    // parallel races those truncations against concurrently-running
    // tests in other files (see lib/tasks/queries.test.ts and
    // lib/memory/queries.test.ts, both of which touch `users`). Disable
    // file parallelism so DB-backed suites run one at a time.
    fileParallelism: false,
  },
});
