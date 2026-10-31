/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pwa } from './pwa/plugin.ts';

const api = process.env.INKADRA_DEV_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), pwa()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/collab': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  test: { setupFiles: ['./src/test/no-network.ts'] },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // zod-jitless.ts must run before any schema is created. Schemas live in chunks that
          // the entry imports, and those run before the entry's own code; in Zod's chunk it
          // runs as soon as Zod itself is loaded.
          groups: [
            { name: 'zod', test: /[\\/]node_modules[\\/]zod[\\/]|[\\/]src[\\/]zod-jitless\.ts$/ },
          ],
        },
      },
    },
  },
});
