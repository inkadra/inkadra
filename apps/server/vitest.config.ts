import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // CI fails instead of skipping the suites that need a database or the media tools (#855).
    // Temporary files go to a folder of the run, removed at the end; a leftover fails the run.
    globalSetup: ['./src/test-global-setup.ts', './src/test-tmpdir.ts'],
    // Every answer under /api/v1 is checked against the API contract (decision 0003).
    setupFiles: ['./src/test-setup.ts'],
  },
});
