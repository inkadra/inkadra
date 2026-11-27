import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { leftovers, removeTempDirs, settleBeforeRemoving, tempDir } from './test-tmpdir.ts';

it('names the test file that left temporary files behind, and what is in them', () => {
  const run = tempDir('run-');
  mkdirSync(join(run, 'file-src--http--clean.test.ts'));
  mkdirSync(join(run, 'file-src--http--leaky.test.ts', 'inkadra-left-1'), { recursive: true });
  const variant = join(run, 'file-src--http--media.test.ts', 'inkadra-test-1', 'files', 'v');
  mkdirSync(variant, { recursive: true });
  writeFileSync(join(variant, '2048.webp'), '');
  mkdirSync(join(run, 'stray'));
  expect(leftovers(run).sort()).toEqual([
    '(outside a test file) stray',
    'src/http/leaky.test.ts: inkadra-left-1',
    `src/http/media.test.ts: ${join('inkadra-test-1', 'files', 'v', '2048.webp')}`,
  ]);
});

it('removes the folders once their background work is done, not before', async () => {
  const dir = tempDir('jobs-');
  let wrote = false;
  // A job that writes into its folder after the test file's hooks, as a media job does.
  settleBeforeRemoving(async () => {
    await new Promise((r) => setTimeout(r, 50));
    mkdirSync(join(dir, 'files', 'variants'), { recursive: true });
    wrote = true;
  });
  await removeTempDirs();
  expect(wrote).toBe(true);
  expect(existsSync(dir)).toBe(false);
});
