import assert from 'node:assert/strict';
import { test } from 'node:test';
import { durations } from './e2e-durations.mjs';
import { assignShards, fileFilter, shuffledShards, specFiles } from './e2e-shards.mjs';

test('longest files go to the lightest shard, with a median for unknown files', () => {
  const weights = { a: 10, b: 6, c: 2 };
  assert.deepEqual(assignShards(['c', 'new', 'a', 'b'], weights, 2), [
    ['a', 'c'],
    ['b', 'new'],
  ]);
  assert.deepEqual(assignShards(['b', 'a'], {}, 2), [['a'], ['b']]);
  assert.throws(() => assignShards(['a'], {}, 0));
  assert.throws(() => assignShards(['a'], {}, 2));
});

test('every normal spec runs exactly once and CLI regexes match only its full path', () => {
  const files = specFiles();
  const shards = assignShards(files, durations, 6);
  assert.deepEqual(shards.flat().sort(), files);
  assert.ok(shards.every((shard) => shard.length > 0));
  assert.ok(!files.some((file) => file.includes('/perf/') || file.endsWith('/first-run.spec.ts')));
  for (const file of files) {
    const filter = new RegExp(fileFilter(file));
    assert.deepEqual(
      files.filter((candidate) => filter.test(`/repo/e2e/${candidate}`)),
      [file],
    );
    assert.ok(filter.test(`H:\\repo\\e2e\\${file.replaceAll('/', '\\')}`));
    assert.ok(!filter.test(`/repo/e2e/other-${file}`));
    assert.ok(!filter.test(`/repo/e2e/${file}.bak`));
    assert.ok(!filter.test(`/repo/e2e/${file.replaceAll('.', 'x')}`));
  }
});

test('a seed deals every spec once, the same way each time, differently from another seed', () => {
  const files = specFiles();
  const shards = shuffledShards(files, 6, 42);
  assert.deepEqual(shards.flat().sort(), files);
  assert.deepEqual(shuffledShards(files, 6, 42), shards);
  assert.notDeepEqual(shuffledShards(files, 6, 43), shards);
  assert.ok(shards.every((shard) => shard.length > 0));
});
