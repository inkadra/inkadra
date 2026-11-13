import { defineConfig } from '@playwright/test';

const port = process.env.E2E_VITE_PORT ?? '5179';
export default defineConfig({
  testDir: './tests',
  testMatch: 'date-field.spec.ts',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, reducedMotion: 'reduce' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `pnpm --filter @inkadra/web exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 60000,
  },
});
