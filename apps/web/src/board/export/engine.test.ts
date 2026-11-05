// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from '@inkadra/doc-schema';
import { light } from '@inkadra/ui/tokens';
import { describe, expect, it } from 'vitest';
import type { Placed } from './board-model.ts';
import type { CardContext } from './board-render.ts';
import { cardPage, selectedCards } from './engine.ts';
import type { Op } from './pages.ts';

const ctx = {
  colors: light,
  measure: (text: string) => text.length * 6,
  noteBlocks: () => [],
  image: (id: string | undefined) => (id ? { key: id, info: { width: 3, height: 2 } } : null),
  frameAspect: () => 16 / 9,
} as unknown as CardContext;

const flat = (ops: readonly Op[]): Op[] =>
  ops.flatMap((op) => (op.kind === 'clip' ? [op, ...flat(op.ops)] : [op]));
const placed = (el: object, w = 300, h = 200): Placed =>
  ({
    el: { id: 'a', parent: null, x: 50, y: 70, w, ...el } as Element,
    x: 50,
    y: 70,
    w,
    h,
  }) as Placed;
const sizes = new Map([['pic', { width: 2048, height: 1365 }]]);

describe('a card as its own picture', () => {
  it('draws an image at its thumbnail pixels, without its card, caption or rounded box', () => {
    const page = cardPage(
      placed({ type: 'image', assetId: 'pic', caption: 'Rim light' }),
      ctx,
      '#161616',
      false,
      sizes,
    );
    expect(page).toMatchObject({ width: 2048, height: 1365, maxScale: 1, background: null });
    const ops = flat(page.ops);
    expect(ops.filter((op) => op.kind === 'text')).toEqual([]);
    expect(ops.some((op) => op.kind === 'rect' && (op.radius || op.stroke))).toBe(false);
    expect(ops.find((op) => op.kind === 'image')).toMatchObject({ x: 0, y: 0, w: 2048, h: 1365 });
  });

  it('puts the board colour under a JPEG and behind a picture that is not ready', () => {
    const image = placed({ type: 'image', assetId: 'pic' });
    const jpeg = cardPage(image, ctx, '#161616', true, sizes);
    expect(jpeg.background).toBe('#161616');
    expect(flat(jpeg.ops).find((op) => op.kind === 'rect')).toMatchObject({ fill: '#161616' });
    expect(cardPage(image, ctx, '#161616', false, new Map()).background).toBe('#161616');
  });

  it('draws a frame without its number, caption or outline', () => {
    const page = cardPage(
      placed({ type: 'frame', assetId: 'pic', action: 'Boats', strokes: [], shapes: [] }),
      ctx,
      '#161616',
      false,
      sizes,
    );
    expect(page.width).toBe(2048);
    expect(page.height).toBeCloseTo(1152);
    const ops = flat(page.ops);
    expect(ops.filter((op) => op.kind === 'text')).toEqual([]);
    expect(ops.some((op) => op.kind === 'rect' && op.stroke)).toBe(false);
    expect(page.ops[0]).toMatchObject({ kind: 'clip', radius: 0 });
  });

  it('keeps any other card whole, with a margin of the board colour', () => {
    const page = cardPage(
      placed({ type: 'color', color: '#ff0000' }),
      ctx,
      '#161616',
      false,
      sizes,
    );
    expect(page).toMatchObject({ width: 348, height: 248, background: '#161616' });
    expect(page.maxScale).toBeUndefined();
    expect(page.ops[0]).toMatchObject({ kind: 'rect', x: 24, y: 24, w: 300, h: 200 });
  });
});

describe('selectedCards', () => {
  const el = (id: string, extra: object = {}) =>
    ({ id, type: 'note', parent: null, x: 0, y: 0, w: 100, ...extra }) as Element;
  const hidden = el('hidden', { guestHidden: true });
  const nested = el('inside', { type: 'frame', parent: 'scene', h: 90 });
  const source = {
    byId: new Map([
      ['a', el('a')],
      ['hidden', hidden],
      ['scene', el('scene', { type: 'scene' })],
      ['inside', nested],
    ]),
    canvas: [el('a'), hidden, el('scene', { type: 'scene' })],
    columns: new Map(),
    heightOf: () => 50,
  };

  it('finds a frame inside its scene by itself, without bringing the scene', () => {
    const cards = selectedCards(source, new Set(['inside']), {
      audience: 'team',
      hideGuestHidden: false,
    });
    expect(cards.map((c) => c.el.id)).toEqual(['inside']);
  });

  it('leaves out what the audience may not see, so a client export can be empty', () => {
    expect(
      selectedCards(source, new Set(['hidden']), { audience: 'client', hideGuestHidden: true }),
    ).toEqual([]);
    expect(
      selectedCards(source, new Set(['a', 'hidden']), {
        audience: 'team',
        hideGuestHidden: false,
      }).map((c) => c.el.id),
    ).toEqual(['a', 'hidden']);
  });
});
