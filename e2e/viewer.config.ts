import { defineConfig } from '@playwright/test';

const port = process.env.E2E_VITE_PORT ?? '5179';
export default defineConfig({
  testDir: './tests',
  testMatch: ['viewer-layout.spec.ts', 'map-dialog.spec.ts'],
  use: { channel: 'chrome' },
  webServer: {
    command: `${process.platform === 'win32' ? 'npx.cmd' : 'npx'} -y pnpm@10.28.0 --filter @inkadra/web dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 60000,
  },
});
