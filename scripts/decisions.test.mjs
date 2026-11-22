import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

// Numbers given twice before this check; cited by number and slug (docs/decisions/README.md).
const KNOWN = ['0025', '0054', '0069', '0071', '0077', '0104', '0124'];

test('a new decision takes a number no other decision has', () => {
  const numbers = readdirSync(new URL('../docs/decisions/', import.meta.url))
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .map((name) => name.slice(0, 4));
  const twice = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))].sort();
  assert.deepEqual(twice, KNOWN);
});
