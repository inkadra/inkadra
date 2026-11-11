import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { durations } from './e2e-durations.mjs';

export function specFiles() {
  return readdirSync(new URL('../e2e/tests/', import.meta.url), { recursive: true })
    .map((file) => file.replaceAll('\\', '/'))
    .filter(
      (file) =>
        file.endsWith('.spec.ts') && !file.startsWith('perf/') && file !== 'first-run.spec.ts',
    )
    .map((file) => `tests/${file}`)
    .sort();
}

export function assignShards(files, weights, count) {
  if (!Number.isInteger(count) || count < 1 || count > files.length) {
    throw new Error('Shard count must be between 1 and the number of specs');
  }
  const known = Object.values(weights).sort((a, b) => a - b);
  const middle = Math.floor(known.length / 2);
  const median = known.length ? (known[middle] + known[Math.floor((known.length - 1) / 2)]) / 2 : 1;
  const weight = (file) => weights[file] ?? median;
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const lightest = shards.reduce((a, b) => (a.seconds <= b.seconds ? a : b));
    lightest.files.push(file);
    lightest.seconds += weight(file);
  }
  return shards.map((shard) => shard.files.sort());
}

export function fileFilter(file) {
  // Playwright matches regexes against absolute paths: anchor both the directory and suffix.
  return `(^|[/\\\\])${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '[/\\\\]')}$`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [index, count] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(index) || index < 1 || index > count) {
    throw new Error('Shard index must be between 1 and the shard count');
  }
  // --project=chromium in test:e2e pulls in the unfiltered first-run dependency first.
  console.log(assignShards(specFiles(), durations, count)[index - 1].map(fileFilter).join('\n'));
}
