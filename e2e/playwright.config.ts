import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the built server in all-in-one mode.
 * Needs Postgres (DATABASE_URL, an empty database) and Valkey/Redis (REDIS_URL);
 * run `pnpm build` first. CI provides both as services.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'it-IT',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'node ../apps/server/dist/main.js all',
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(port),
      PUBLIC_URL: baseURL,
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://inkadra:inkadra@localhost:5432/inkadra_e2e',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only',
      WEB_DIST: '../apps/web/dist',
      INKADRA_VERSION: '0.1.0-e2e',
      LOG_LEVEL: 'warn',
    },
  },
});
