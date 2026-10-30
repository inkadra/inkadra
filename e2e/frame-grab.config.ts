import { defineConfig } from '@playwright/test';
import config from './playwright.config.ts';

// Isolated run for media capture; no Vite server and no shared preview port.
export default defineConfig({
  ...config,
  testMatch: 'frame-grab.spec.ts',
  use: { ...config.use, channel: 'chrome' },
  webServer: Array.isArray(config.webServer) ? config.webServer.slice(1) : config.webServer,
});
