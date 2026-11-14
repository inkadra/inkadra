/// <reference types="vitest/config" />
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, gzip } from 'node:zlib';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { pwa } from './pwa/plugin.ts';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/**
 * Writes .br and .gz copies of the text files next to them; the server sends them to browsers
 * that accept them (`preCompressed` in apps/server/src/http/app.ts), the first board open on a
 * phone downloads a third of the bytes (#827). A proxy in front can still compress on its own.
 */
function precompress(): Plugin {
  return {
    name: 'inkadra-precompress',
    apply: 'build',
    async writeBundle(output, bundle) {
      const dir = output.dir ?? 'dist';
      const files = Object.keys(bundle).filter((name) => /\.(js|css|html|svg|json)$/.test(name));
      await Promise.all(
        files.map(async (name) => {
          const item = bundle[name];
          const source = item?.type === 'chunk' ? item.code : item?.source;
          if (source === undefined || source.length < 1024) return;
          const [br, gzipped] = await Promise.all([brotli(source), gz(source)]);
          await writeFile(join(dir, `${name}.br`), br);
          await writeFile(join(dir, `${name}.gz`), gzipped);
        }),
      );
    },
  };
}

const api = process.env.INKADRA_DEV_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), pwa(), precompress()],
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
