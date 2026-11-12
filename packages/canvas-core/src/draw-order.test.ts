// SPDX-License-Identifier: MPL-2.0
import { compareZ } from '@inkadra/doc-schema';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { expect, it } from 'vitest';

/** Keys as the board makes them, in the order they were meant to have. */
function generatedKeys(): string[] {
  const keys = [generateKeyBetween(null, null)];
  // Cards added on top, sent to the back (keys before `a0`), then slotted in between.
  for (let i = 0; i < 80; i += 1) keys.push(generateKeyBetween(keys.at(-1) ?? null, null));
  for (let i = 0; i < 80; i += 1) keys.unshift(generateKeyBetween(null, keys[0] ?? null));
  for (let i = keys.length - 2; i >= 0; i -= 7)
    keys.splice(i + 1, 0, ...generateNKeysBetween(keys[i] ?? null, keys[i + 1] ?? null, 5));
  return keys;
}

const shuffled = <T>(items: T[]) =>
  items.map((item, i) => ({ item, at: (i * 7919) % items.length })).sort((a, b) => a.at - b.at);

it('orders the keys the board generates as they were generated', () => {
  const keys = generatedKeys();
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.some((k) => /^[A-Z]/.test(k)) && keys.some((k) => /[a-z]$/.test(k))).toBe(true);
  expect(new Set(keys.map((k) => k.length)).size).toBeGreaterThan(1);
  const els = shuffled(keys).map(({ item }, i) => ({ z: item, id: `id${i}` }));
  expect(els.sort(compareZ).map((e) => e.z)).toEqual(keys);
});

it('breaks equal generated keys by id, whatever the input order', () => {
  const [low, high] = generateNKeysBetween(null, null, 2) as [string, string];
  const els = [
    { z: high, id: 'Bb' },
    { z: low, id: 'b' },
    { z: low, id: 'B' },
    { z: high, id: 'a' },
  ];
  const expected = ['B', 'b', 'Bb', 'a'];
  expect([...els].sort(compareZ).map((e) => e.id)).toEqual(expected);
  expect([...els].reverse().sort(compareZ).map((e) => e.id)).toEqual(expected);
});

/**
 * Collation (`localeCompare`, `Intl.Collator`) does not order these keys: it ignores case at
 * first and puts lower case before upper case. Browsers collate with the same ICU root rules.
 */
it('shows that localeCompare orders generated keys differently', () => {
  const keys = generatedKeys();
  const disagree: [string, string][] = [];
  for (const a of keys)
    for (const b of keys)
      if (a < b && a.localeCompare(b) > 0 && disagree.length < 1000) disagree.push([a, b]);
  // A card sent to the back (`Zz`) came after the first one (`a0`).
  expect(disagree).toContainEqual(['Zz', 'a0']);
  // Cards slotted in between `a0` and `a1`: an upper-case digit such as `V` (before `l` by code
  // unit) collates as `v`, after `l`.
  expect(disagree.some(([a, b]) => a.slice(0, 2) === 'a0' && b.slice(0, 2) === 'a0')).toBe(true);
  expect([...keys].sort((a, b) => a.localeCompare(b))).not.toEqual(keys);
});
