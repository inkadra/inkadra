import type { Element } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { viewableInOrder } from './gallery.ts';

const el = (id: string, type: string, x: number, y: number, extra: object = {}) =>
  ({ id, type, x, y, w: 10, h: 10, ...extra }) as unknown as Element;

describe('viewableInOrder', () => {
  const all = [
    el('c', 'image', 50, 100),
    el('note', 'note', 0, 0),
    el('b', 'file', 80, 0),
    el('a', 'image', 10, 0),
    el('yt', 'link', 0, 200, { url: 'https://youtu.be/dQw4w9WgXcQ' }),
    el('plain', 'link', 0, 300, { url: 'https://example.com' }),
    el('hidden', 'image', 0, 50, { guestHidden: true }),
  ];

  it('keeps media only, top to bottom then left to right', () => {
    expect(viewableInOrder(all, false).map((e) => e.id)).toEqual(['a', 'b', 'hidden', 'c', 'yt']);
  });

  it('drops the cards hidden from guests in guest mode', () => {
    expect(viewableInOrder(all, true).map((e) => e.id)).toEqual(['a', 'b', 'c', 'yt']);
  });
});
