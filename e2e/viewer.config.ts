import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'viewer-layout.spec.ts',
  use: { channel: 'chrome' },
  webServer: {
    command:
      'npx.cmd -y pnpm@10.28.0 --filter @inkadra/web dev --host 127.0.0.1 --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179',
    timeout: 60000,
  },
});
