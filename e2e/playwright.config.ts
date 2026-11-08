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
const vitePort = Number(process.env.E2E_VITE_PORT ?? 5179);
const port = Number(process.env.E2E_PORT ?? 3100);
// Map tiles come from a local stand-in, unless a run asks for a real server (screenshots).
const tilePort = Number(process.env.E2E_TILE_PORT ?? 3190);
const tileUrl = process.env.E2E_MAP_TILE_URL ?? `http://127.0.0.1:${tilePort}/{z}/{x}/{y}.png`;
// Lets setOffline() and routes reach the service worker's own requests, as a real outage would.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';
const baseURL = `http://localhost:${port}`;
// demo.spec.ts: a second server in demo mode (decision 0084).
const demoPort = Number(process.env.E2E_DEMO_PORT ?? 3110);
process.env.E2E_DEMO_URL = `http://localhost:${demoPort}`;
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://inkadra:inkadra@localhost:5432/inkadra_e2e';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
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
    // The tests measure layout: menus and dialogs must not be caught mid-animation (#332).
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    {
      // Create the administrator before any fixture can sign up the shared test account.
      name: 'first-run',
      testMatch: 'first-run.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium',
      testIgnore: ['**/perf/**', '**/first-run.spec.ts'],
      dependencies: ['first-run'],
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
        // With the animations people see.
        reducedMotion: 'no-preference',
      },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @inkadra/web exec vite --host 127.0.0.1 --port ${vitePort} --strictPort`,
      url: `http://127.0.0.1:${vitePort}`,
      timeout: 60_000,
    },
    {
      command: 'node ../apps/server/dist/main.js all',
      url: `${baseURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        AUTH_RATE_LIMITS: 'off',
        PORT: String(port),
        PUBLIC_URL: baseURL,
        // Never the real relay: nothing listens here, so a report waits in the local queue.
        FEEDBACK_RELAY_URL: 'http://127.0.0.1:9',
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only',
        WEB_DIST: webDist,
        // Uploaded files; the default /data only exists in the image.
        DATA_DIR: process.env.E2E_DATA_DIR ?? join(tmpdir(), 'inkadra-e2e'),
        INKADRA_VERSION: '0.1.0-e2e',
        // Never GitHub: the update check fails at once and the tests keep their screens.
        UPDATE_CHECK_URL: 'http://127.0.0.1:9/releases',
        MAP_TILE_URL: tileUrl,
        MAP_SATELLITE_TILE_URL: `http://127.0.0.1:${tilePort}/satellite/{z}/{x}/{y}.png`,
        MAP_GEOCODER_URL: process.env.E2E_GEOCODER_URL ?? `http://127.0.0.1:${tilePort}/geocode`,
        LOG_LEVEL: 'warn',
        // storage-limits-locked.spec.ts: the limits of a managed server (decision 0081).
        STORAGE_LIMIT: process.env.STORAGE_LIMIT ?? '',
        STORAGE_LIMIT_PER_USER: process.env.STORAGE_LIMIT_PER_USER ?? '',
      },
    },
    {
      command: 'node scripts/demo-server.mjs',
      url: `http://localhost:${demoPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        // Every test opens sandboxes from the same address.
        AUTH_RATE_LIMITS: 'off',
        PORT: String(demoPort),
        PUBLIC_URL: `http://localhost:${demoPort}`,
        E2E_MAIN_DATABASE_URL: databaseUrl,
        E2E_MAIN_REDIS_URL: redisUrl,
        AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only',
        WEB_DIST: webDist,
        DATA_DIR: process.env.E2E_DEMO_DATA_DIR ?? join(tmpdir(), 'inkadra-e2e-demo'),
        INKADRA_VERSION: '0.1.0-e2e',
        UPDATE_CHECK_URL: 'http://127.0.0.1:9/releases',
        LOG_LEVEL: 'warn',
        DEMO_MODE: 'true',
      },
    },
    // Last: canvas-06 and frame-grab drop the first entry (Vite) and keep the rest.
    {
      command: 'node scripts/tile-server.mjs',
      url: `http://127.0.0.1:${tilePort}/0/0/0.png`,
      env: { E2E_TILE_PORT: String(tilePort) },
      timeout: 10_000,
    },
  ],
});
