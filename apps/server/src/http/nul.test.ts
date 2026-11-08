import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { containsNul } from './nul.ts';

describe('containsNul', () => {
  it('finds U+0000 in strings, arrays and keys of parsed JSON and queries', () => {
    expect(containsNul({ a: ['x', { b: 'y\u0000' }] })).toBe(true);
    expect(containsNul({ ['k\u0000']: 1 })).toBe(true);
    expect(containsNul(Object.assign(Object.create(null), { q: 'a\u0000' }))).toBe(true);
    const query = Object.create(Object.create(null));
    query.q = 'a\u0000b';
    expect(containsNul(query)).toBe(true);
    expect(containsNul({ a: ['x', 1, null, true] })).toBe(false);
  });

  it('leaves bodies that are not text alone', () => {
    expect(containsNul(Buffer.from([0, 0, 0]))).toBe(false);
    expect(containsNul(new PassThrough())).toBe(false);
  });
});
