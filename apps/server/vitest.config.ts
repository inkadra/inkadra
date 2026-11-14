import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // CI fails instead of skipping the suites that need a database or the media tools (#855).
    globalSetup: ['./src/test-global-setup.ts'],
  },
});
