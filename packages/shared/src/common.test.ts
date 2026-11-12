// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { comparePosition } from './common.ts';

const order = (items: { position: string; id: string }[]) =>
  [...items].sort(comparePosition).map((s) => `${s.position}/${s.id}`);

it('orders siblings by position as code units, never by locale', () => {
  // `localeCompare` would put `a0` before `Zz` and `a0v` before `a0V`.
  expect(
    order([
      { position: 'a1', id: '1' },
      { position: 'a0v', id: '2' },
      { position: 'Zz', id: '3' },
      { position: 'a0V', id: '4' },
      { position: 'a0', id: '5' },
    ]),
  ).toEqual(['Zz/3', 'a0/5', 'a0V/4', 'a0v/2', 'a1/1']);
});

it('breaks a tie of positions by id, so every client lists them alike', () => {
  expect(
    order([
      { position: 'a0', id: 'b' },
      { position: 'a0', id: 'a' },
      { position: 'Zz', id: 'c' },
    ]),
  ).toEqual(['Zz/c', 'a0/a', 'a0/b']);
  expect(comparePosition({ position: 'a0', id: 'x' }, { position: 'a0', id: 'x' })).toBe(0);
});
