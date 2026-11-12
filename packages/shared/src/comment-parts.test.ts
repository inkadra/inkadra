// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { commentParts } from './comments.ts';

const ANNA = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const LUCA = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
const person = (id: string, name: string) => ({ id, name, image: null });

describe('commentParts', () => {
  it('is empty for an empty body and one text part without mentions', () => {
    expect(commentParts({ body: '', mentions: [] })).toEqual([]);
    expect(commentParts({ body: 'Fine', mentions: [] })).toEqual([{ text: 'Fine' }]);
  });

  it('splits text and listed mentions in order, whatever the case of the id', () => {
    const body = `@{${ANNA.toUpperCase()}} and @{${LUCA}}, look`;
    expect(commentParts({ body, mentions: [person(ANNA, 'Anna'), person(LUCA, 'Luca')] })).toEqual([
      { mention: 'Anna' },
      { text: ' and ' },
      { mention: 'Luca' },
      { text: ', look' },
    ]);
  });

  it('keeps an id that is not listed as typed text', () => {
    const body = `Ask @{${LUCA}} or @{${ANNA}}`;
    expect(commentParts({ body, mentions: [person(ANNA, 'Anna')] })).toEqual([
      { text: `Ask @{${LUCA}} or ` },
      { mention: 'Anna' },
    ]);
  });
});
