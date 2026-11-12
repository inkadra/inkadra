import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check } from './check-licenses.mjs';

test('counts every package and flags only licences outside the allow-list', () => {
  const pkg = (name) => ({ name, versions: ['1.0.0'] });
  const result = check({
    MIT: [pkg('a'), pkg('b')],
    '(MIT OR GPL-3.0)': [pkg('c')],
    '(MIT AND GPL-3.0)': [pkg('d')],
    Unknown: [pkg('combine-errors'), pkg('e')],
  });
  assert.equal(result.count, 6);
  assert.deepEqual(result.problems, ['d@1.0.0: (MIT AND GPL-3.0)', 'e@1.0.0: Unknown']);
  assert.deepEqual(check({}), { count: 0, problems: [] });
});
