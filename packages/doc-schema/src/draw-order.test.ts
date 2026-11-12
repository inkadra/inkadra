// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { compareZ } from './draw-order.ts';

const el = (z: string, id: string) => ({ z, id });
const order = (els: { z: string; id: string }[]) =>
  [...els].sort(compareZ).map((e) => `${e.z}/${e.id}`);

it('orders keys by code unit: upper case, then lower case, digits first, shorter first', () => {
  expect(
    order([el('a1', 'x'), el('a0v', 'x'), el('Zz', 'x'), el('a0V', 'x'), el('a0', 'x')]),
  ).toEqual(['Zz/x', 'a0/x', 'a0V/x', 'a0v/x', 'a1/x']);
  expect(order([el('aA', 'x'), el('a9', 'x'), el('a', 'x')])).toEqual(['a/x', 'a9/x', 'aA/x']);
});

it('breaks equal keys by id', () => {
  expect(order([el('a0', 'b'), el('a0', 'B'), el('a0', 'a')])).toEqual(['a0/B', 'a0/a', 'a0/b']);
});

it('is a consistent comparator', () => {
  const keys = ['a0', 'a0V', 'a0v', 'Zz', 'a1', 'A00000000000000000000000000', 'z', 'a'];
  const els = keys.flatMap((z) => [el(z, 'id1'), el(z, 'Id2')]);
  for (const a of els) {
    expect(compareZ(a, a)).toBe(0);
    for (const b of els) {
      expect(Math.sign(compareZ(a, b)) + Math.sign(compareZ(b, a))).toBe(0);
      for (const c of els)
        if (compareZ(a, b) < 0 && compareZ(b, c) < 0) expect(compareZ(a, c)).toBeLessThan(0);
    }
  }
});

it('gives the same order whatever order the input comes in', () => {
  const els = [el('a1', 'p'), el('a0', 'q'), el('a0', 'p'), el('Zz', 'r'), el('a0V', 's')];
  const expected = order(els);
  expect(order([...els].reverse())).toEqual(expected);
  expect(order([els[2], els[4], els[0], els[3], els[1]] as typeof els)).toEqual(expected);
});
