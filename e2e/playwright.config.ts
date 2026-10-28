import { cpSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the built server in all-in-one mode.
 * Needs Postgres (DATABASE_URL, an empty database) and Valkey/Redis (REDIS_URL);
 * run `pnpm build` first. CI provides both as services.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
// Lets setOffline() and routes reach the service worker's own requests, as a real outage would.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';
const baseURL = `http://localhost:${port}`;
// The server serves a copy of the web build, so a test can change it (pwa.spec.ts deploys a
// new /sw.js) without touching apps/web/dist. Workers load this file too; only the runner copies.
const webDist = join(tmpdir(), `inkadra-e2e-web-${port}`);
process.env.E2E_WEB_DIST = webDist;
const builtWeb = fileURLToPath(new URL('../apps/web/dist', import.meta.url));
if (!process.env.TEST_WORKER_INDEX && existsSync(builtWeb)) {
  rmSync(webDist, { recursive: true, force: true });
  cpSync(builtWeb, webDist, { recursive: true });
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries: the tests are one story over a database that only moves forward.
  retries: 0,
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
      testIgnore: '**/perf/**',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Load tests, run on their own with `pnpm test:perf`.
      name: 'perf',
      testDir: './tests/perf',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // Timings measure the app; the worker's first install would compete with it.
        serviceWorkers: 'block',
      },
    },
  ],
  webServer: {
    command: 'node ../apps/server/dist/main.js all',
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'development',
      AUTH_RATE_LIMITS: 'off',
      PORT: String(port),
      PUBLIC_URL: baseURL,
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://inkadra:inkadra@localhost:5432/inkadra_e2e',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only',
      WEB_DIST: webDist,
      // Uploaded files; the default /data only exists in the image.
      DATA_DIR: process.env.E2E_DATA_DIR ?? join(tmpdir(), 'inkadra-e2e'),
      INKADRA_VERSION: '0.1.0-e2e',
      LOG_LEVEL: 'warn',
    },
  },
});
