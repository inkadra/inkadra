import { defineConfig } from '@playwright/test';
import config from './playwright.config.ts';

// Isolated run for the 0.7 animatic and its screenshots; no Vite server, no shared preview port.
export default defineConfig({
  ...config,
  testMatch: 'animatic.spec.ts',
  use: { ...config.use, channel: 'chrome' },
  webServer: Array.isArray(config.webServer) ? config.webServer.slice(1) : config.webServer,
});
