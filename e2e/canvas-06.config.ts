import { defineConfig } from '@playwright/test';
import config from './playwright.config.ts';

// Isolated run for the 0.6 canvas screenshots; no Vite server and no shared preview port.
export default defineConfig({
  ...config,
  testMatch: ['map-arrows.spec.ts', 'story-cards.spec.ts'],
  use: { ...config.use, channel: 'chrome' },
  webServer: Array.isArray(config.webServer) ? config.webServer.slice(1) : config.webServer,
});
