import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
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
  }, 'a media job');
  await removeTempDirs();
  expect(wrote).toBe(true);
  expect(existsSync(dir)).toBe(false);
});

afterEach(() => {
  vi.useRealTimers();
});

it('stops waiting for work that never ends, names it, and still removes the folders', async () => {
  vi.useFakeTimers();
  const dir = tempDir('hung-');
  settleBeforeRemoving(() => new Promise(() => {}), 'a hung job');
  settleBeforeRemoving(async () => {}, 'a finished job');
  const removed = removeTempDirs();
  const failed = expect(removed).rejects.toThrow(
    /settleBeforeRemoving\(\) did not finish in 10 s: a hung job$/,
  );
  await vi.advanceTimersByTimeAsync(10_000);
  await failed;
  expect(existsSync(dir)).toBe(false);
});

it('removes the folders when work fails or throws, after all of it settled, then says so', async () => {
  const dir = tempDir('failed-');
  let late = false;
  settleBeforeRemoving(() => Promise.reject(new Error('job failed')), 'a failing job');
  settleBeforeRemoving(() => {
    throw new Error('job threw');
  }, 'a throwing job');
  settleBeforeRemoving(async () => {
    await new Promise((r) => setTimeout(r, 20));
    late = true;
  }, 'a slow job');
  const error = await removeTempDirs().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
    'job failed',
    'job threw',
  ]);
  expect(late).toBe(true);
  expect(existsSync(dir)).toBe(false);
});

it('passes on the one error of a single failing job as it is', async () => {
  const dir = tempDir('one-');
  settleBeforeRemoving(() => Promise.reject(new Error('only failure')), 'a failing job');
  await expect(removeTempDirs()).rejects.toThrow('only failure');
  expect(existsSync(dir)).toBe(false);
});
