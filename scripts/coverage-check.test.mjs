import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check } from './coverage-check.mjs';

test('fails a workspace under its floor, without a floor or without a report', () => {
  const summary = (lines, branches) => ({
    total: { lines: { pct: lines }, branches: { pct: branches } },
  });
  const floors = {
    a: { lines: 50, branches: 40 },
    b: { lines: 50, branches: 40 },
    c: { lines: 1, branches: 1 },
  };
  assert.deepEqual(check(floors, { a: summary(50, 40) }), []);
  assert.deepEqual(check(floors, { b: summary(49.9, 41), c: null, d: summary(90, 90) }), [
    'b: lines 49.9% < floor 50%',
    'c: no coverage report',
    'd: no floor in scripts/coverage-floors.json',
  ]);
});
