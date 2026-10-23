import { build } from 'esbuild';

// Bundles the server and the workspace packages (@inkadra/*) into dist/main.js.
// Other npm dependencies stay external and are installed in the image.
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [
    {
      name: 'externalize-npm',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@inkadra/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
  logLevel: 'info',
});
