import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../src/openapi.ts';

const target = fileURLToPath(new URL('../openapi.json', import.meta.url));
const next = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {}
  if (current !== next) {
    console.error('openapi.json is out of date. Run `pnpm openapi` and commit the result.');
    process.exit(1);
  }
  console.log('openapi.json is up to date.');
} else {
  writeFileSync(target, next);
  console.log(`Wrote ${target}`);
}
