// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { referenceGroups } from './moodboard.ts';
import { normaliseTag } from './tags.ts';

const ref = (id: string, group?: string) => ({ id, group });

describe('moodboard groups', () => {
  it('is empty without references and has one loose group without names', () => {
    expect(referenceGroups([])).toEqual([]);
    expect(referenceGroups([ref('a'), ref('b', '')])).toEqual([
      { name: null, items: [ref('a'), ref('b', '')] },
    ]);
  });

  it('groups names as tags, by name, with the loose references last', () => {
    const items = [
      ref('a', 'Night'),
      ref('b'),
      ref('c', ' night '),
      ref('d', 'Day'),
      ref('e', 'NIGHT'),
    ];
    expect(referenceGroups(items)).toEqual([
      { name: 'Day', items: [ref('d', 'Day')] },
      { name: 'Night', items: [ref('a', 'Night'), ref('c', ' night '), ref('e', 'NIGHT')] },
      { name: null, items: [ref('b')] },
    ]);
  });

  it('normalises tags: trimmed, no leading #, single spaces, lower case, 40 characters', () => {
    expect(normaliseTag('  #Golden   Hour ')).toBe('golden hour');
    expect(normaliseTag('##x')).toBe('#x');
    expect(normaliseTag('a'.repeat(50))).toHaveLength(40);
    expect(normaliseTag('')).toBe('');
  });
});
