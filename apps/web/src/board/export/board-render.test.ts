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

describe('set plans in exports', () => {
  it('draws the title, the drawing in theme colours and the icon labels, without a grid', () => {
    const plan = card({
      type: 'plan',
      title: 'Cucina',
      strokes: [
        { id: 'stroke001', tool: 'pencil', color: '#1C1C1E', width: 4, points: [0, 0, 4096, 4096] },
      ],
      icons: [
        {
          id: 'icon0001',
          kind: 'camera',
          color: '#9DB8F2',
          x: 2048,
          y: 2048,
          rotation: 90,
          label: 'A cam',
        },
      ],
    });
    const [, clip] = drawBoard([{ ...plan, h: 34 + 640 / 1.5 }], {
      ...ctx,
      words: { board: '', file: '', plan: 'Pianta del set' },
    });
    const face = (clip as Extract<typeof clip, { kind: 'clip' }>).ops;
    expect(face[0]).toMatchObject({ kind: 'text', text: 'Pianta del set · Cucina' });
    const drawing = face.find((o) => o.kind === 'clip') as Extract<
      (typeof face)[number],
      { kind: 'clip' }
    >;
    expect(drawing).toMatchObject({ x: 0, y: 34, w: 640 });
    // Ink and palette colours print with the theme's tokens.
    expect(drawing.ops[0]).toMatchObject({ kind: 'polyline', color: '#text-secondary' });
    const polygons = drawing.ops.filter((o) => o.kind === 'polygon');
    // The view cone, the body and the lens of the camera.
    expect(polygons).toHaveLength(3);
    // Turned 90°: the cone points down from the centre (320, 34 + 213).
    const cone = polygons[0] as Extract<(typeof polygons)[number], { kind: 'polygon' }>;
    const ys = cone.points.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(34 + 213);
    expect(drawing.ops.at(-1)).toMatchObject({ kind: 'text', text: 'A cam', color: '#tag-blue' });
  });
});
