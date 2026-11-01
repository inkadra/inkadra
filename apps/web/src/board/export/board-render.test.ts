import type { Element } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { type CardContext, drawBoard, type Palette } from './board-render.ts';

const colors = new Proxy({}, { get: (_, key) => `#${String(key)}` }) as Palette;
const ctx = {
  measure: (text: string) => text.length * 6,
  colors,
  noteBlocks: () => [],
  image: () => null,
  fileName: () => '',
  boardTitle: () => '',
} as unknown as CardContext;

const arrow = (fields: Partial<Extract<Element, { type: 'arrow' }>>) => {
  const el = {
    id: 'arrow001',
    type: 'arrow',
    x: 0,
    y: 0,
    w: 200,
    h: 1,
    z: 'a1',
    parent: null,
    createdBy: null,
    createdAt: 0,
    from: { x: 0, y: 0 },
    to: { x: 200, y: 0 },
    ...fields,
  } as Element;
  return { el, x: 0, y: 0, w: 200, h: 1 };
};

describe('arrows in exports', () => {
  it('draws a straight arrow with its label on a chip at the middle', () => {
    const ops = drawBoard([arrow({ label: 'conosce' })], ctx);
    expect(ops.map((o) => o.kind)).toEqual(['line', 'polygon', 'rect', 'text']);
    const chip = ops[2] as Extract<(typeof ops)[number], { kind: 'rect' }>;
    expect(chip.fill).toBe('#surface-1');
    expect(chip.x + chip.w / 2).toBeCloseTo(100);
  });

  it('draws a curved arrow along the curve, label at its top, heads at both ends', () => {
    const ops = drawBoard([arrow({ label: 'conosce', path: 'curved', heads: 'both' })], ctx);
    expect(ops.map((o) => o.kind)).toEqual(['polyline', 'polygon', 'polygon', 'rect', 'text']);
    const chip = ops[3] as Extract<(typeof ops)[number], { kind: 'rect' }>;
    expect(chip.y + chip.h / 2).toBeCloseTo(-36);
  });

  it('dashes a curved arrow and leaves the heads out when asked', () => {
    const ops = drawBoard([arrow({ path: 'curved', line: 'dashed', heads: 'none' })], ctx);
    expect(ops.length).toBeGreaterThan(10);
    expect(ops.every((o) => o.kind === 'line')).toBe(true);
  });
});

const card = (fields: Record<string, unknown>) => ({
  el: {
    id: 'card0001',
    x: 0,
    y: 0,
    w: 640,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 0,
    ...fields,
  } as Element,
  x: 0,
  y: 0,
  w: 640,
  h: 44,
});

describe('board elements in exports', () => {
  it('draws a section heading as text over a rule, without a card', () => {
    const ops = drawBoard([card({ type: 'section', title: 'Sequenza 1' })], ctx);
    expect(ops.map((o) => o.kind)).toEqual(['text', 'line']);
    expect(ops[0]).toMatchObject({ text: 'Sequenza 1', size: 20 });
  });

  it('draws the accent bar and tint of a coloured column', () => {
    const [, clip] = drawBoard([card({ type: 'column', title: 'Da fare', color: 'green' })], ctx);
    const inner = (clip as Extract<typeof clip, { kind: 'clip' }>).ops;
    expect(inner.slice(0, 2)).toMatchObject([
      { kind: 'rect', fill: '#tag-green-bg' },
      { kind: 'rect', h: 3, fill: '#tag-green' },
    ]);
  });
});
