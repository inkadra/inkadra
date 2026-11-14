import { describe, expect, it } from 'vitest';
import { firstCard, nextCard } from './card-focus.ts';

//  a  b
//  c     d
const cards = [
  { id: 'd', x: 400, y: 200, w: 100, h: 100 },
  { id: 'b', x: 200, y: 0, w: 100, h: 100 },
  { id: 'c', x: 0, y: 200, w: 100, h: 100 },
  { id: 'a', x: 0, y: 0, w: 100, h: 100 },
];

describe('keyboard focus among cards', () => {
  it('starts at the top left card', () => {
    expect(firstCard(cards)).toBe('a');
    expect(firstCard([])).toBeUndefined();
  });

  it('moves to the nearest card in the direction of the arrow, keeping to the row', () => {
    expect(nextCard(cards, 'a', 'right')).toBe('b');
    expect(nextCard(cards, 'a', 'down')).toBe('c');
    expect(nextCard(cards, 'c', 'right')).toBe('d');
    expect(nextCard(cards, 'd', 'left')).toBe('c');
    expect(nextCard(cards, 'd', 'up')).toBe('b');
    // Nothing further: focus stays where it is.
    expect(nextCard(cards, 'a', 'left')).toBeUndefined();
    // A card gone from view: start again from the first.
    expect(nextCard(cards, 'gone', 'right')).toBe('a');
  });
});
