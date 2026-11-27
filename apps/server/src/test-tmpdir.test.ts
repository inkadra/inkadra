import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { leftovers, tempDir } from './test-tmpdir.ts';

it('names the test file that left temporary files behind', () => {
  const run = tempDir('run-');
  mkdirSync(join(run, 'file-src--http--clean.test.ts'));
  mkdirSync(join(run, 'file-src--http--leaky.test.ts', 'inkadra-left-1'), { recursive: true });
  mkdirSync(join(run, 'stray'));
  expect(leftovers(run).sort()).toEqual([
    '(outside a test file) stray',
    'src/http/leaky.test.ts: inkadra-left-1',
  ]);
});
