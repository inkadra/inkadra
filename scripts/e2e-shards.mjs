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

/**
 * Specs in a random order, dealt to the shards in turn (#857): the nightly run puts each spec next
 * to other ones than the pull requests do, so a spec that needs another one's data fails there.
 * The seed is printed, so a failing composition can be run again.
 */
export function shuffledShards(files, count, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const order = [...files].sort();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const shards = Array.from({ length: count }, () => []);
  for (const [i, file] of order.entries()) shards[i % count].push(file);
  return shards;
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
  const seed = process.env.E2E_SHARD_SEED;
  if (seed) console.error(`Shards dealt at random, seed ${seed} (E2E_SHARD_SEED)`);
  const shards = seed
    ? shuffledShards(specFiles(), count, Number(seed))
    : assignShards(specFiles(), durations, count);
  // --project=chromium in test:e2e pulls in the unfiltered first-run dependency first.
  console.log(shards[index - 1].map(fileFilter).join('\n'));
}
