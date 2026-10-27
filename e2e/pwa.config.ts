import { defineConfig } from '@playwright/test';

// The lifecycle fixture serves only built public files; no database or app server.
export default defineConfig({
  testDir: './tests',
  testMatch: 'pwa-lifecycle.spec.ts',
  workers: 1,
  use: {
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
