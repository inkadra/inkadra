import type { Element } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { audienceCards } from './board-model.ts';
import { type CardContext, drawBoard, type Palette, planOps } from './board-render.ts';
import type { Op } from './pages.ts';

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
  it('draws a section heading as text, without a card or a rule', () => {
    const ops = drawBoard([card({ type: 'section', title: 'Sequenza 1' })], ctx);
    expect(ops.map((o) => o.kind)).toEqual(['text']);
    expect(ops[0]).toMatchObject({ text: 'Sequenza 1', size: 20 });
  });

  it('draws a section heading on its background', () => {
    const ops = drawBoard([card({ type: 'section', title: 'Atto', background: 'teal' })], ctx);
    expect(ops.map((o) => o.kind)).toEqual(['rect', 'text']);
    expect(ops[0]).toMatchObject({ fill: '#E4F1F6' });
    const black = drawBoard([card({ type: 'section', title: 'Atto', background: 'black' })], ctx);
    expect(black[0]).toMatchObject({ fill: '#161616' });
    expect(black[1]).toMatchObject({ color: '#EDEDED' });
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
    // The view cone, see-through, and the opaque body and lens of the camera (decision 0104).
    expect(polygons).toHaveLength(3);
    expect(polygons[0]).toMatchObject({ opacity: 0.14 });
    expect(polygons[1]).not.toHaveProperty('opacity');
    // Turned 90°: the cone points down from the centre (320, 34 + 213).
    const cone = polygons[0] as Extract<(typeof polygons)[number], { kind: 'polygon' }>;
    const ys = cone.points.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(34 + 213);
    expect(drawing.ops.at(-1)).toMatchObject({ kind: 'text', text: 'A cam', color: '#tag-blue' });
  });
});

it('exports source image strokes through the same crop and rotation as the picture', () => {
  const local = { ...ctx, image: () => ({ key: 'image', info: { width: 1000, height: 500 } }) };
  const ops = drawBoard(
    [
      card({
        type: 'image',
        assetId: 'assetAAAAAAAA',
        rotation: 90,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        strokes: [
          {
            id: 'strokeAAAAAA',
            tool: 'pencil',
            color: '#E5484D',
            width: 3,
            points: [0, 0, 4096, 4096],
          },
        ],
      }),
    ],
    local,
  );
  const flatten = (items: typeof ops): typeof ops =>
    items.flatMap((op) => (op.kind === 'clip' ? flatten(op.ops) : [op]));
  const stroke = flatten(ops).find((op) => op.kind === 'polyline');
  expect(stroke).toBeDefined();
  if (stroke?.kind === 'polyline') {
    expect(stroke.points[0]).toBeGreaterThan(stroke.points[2]!);
    expect(stroke.points[1]).toBeLessThan(stroke.points[3]!);
  }
});

it('exports explicit section bold at 700 while preserving legacy 600 and explicit normal 400', () => {
  for (const [bold, weight] of [
    [undefined, 600],
    [false, 400],
    [true, 700],
  ] as const) {
    const ops = drawBoard([card({ type: 'section', title: 'Title', bold })], ctx);
    expect(ops.find((op) => op.kind === 'text')).toMatchObject({ weight });
  }
});

describe('set plan links in exports (decision 0111)', () => {
  const card = { x: 0, y: 0, w: 100, z: 'a0', createdBy: null, createdAt: 1 };
  const leo = { ...card, id: 'charAAAAAAAAA', parent: null, type: 'character', name: 'Leo' };
  const secret = {
    ...card,
    id: 'charBBBBBBBBB',
    parent: null,
    type: 'character',
    name: 'Secret',
    guestHidden: true,
  };
  const tray = {
    ...card,
    id: 'charCCCCCCCCC',
    parent: 'unsorted',
    type: 'character',
    name: 'Tray',
  };
  const actor = (id: string, characterId: string) => ({
    id,
    kind: 'actor',
    color: '#9DB8F2',
    x: 5000,
    y: 5000,
    characterId,
  });
  const plan = {
    ...card,
    id: 'planAAAAAAAAA',
    parent: null,
    type: 'plan',
    icons: [
      actor('iconAAAAAAAAA', leo.id),
      actor('iconBBBBBBBBB', secret.id),
      actor('iconCCCCCCCCC', tray.id),
    ],
  } as unknown as Extract<Element, { type: 'plan' }>;
  const all = [leo, secret, tray, plan] as unknown as Element[];
  const byId = new Map(all.map((e) => [e.id, e]));
  const texts = (ops: readonly Op[]): string[] =>
    ops.flatMap((op) => (op.kind === 'text' ? [op.text] : op.kind === 'clip' ? texts(op.ops) : []));
  const drawn = (audience: 'team' | 'client') =>
    texts(
      planOps(
        plan,
        { x: 0, y: 0, w: 600, h: 400 },
        {
          ...ctx,
          cards: audienceCards(all, (id) => byId.get(id), {
            audience,
            hideGuestHidden: audience === 'client',
          }),
        },
      ),
    );

  it('draws the live names of the characters the team may see', () => {
    expect(drawn('team')).toEqual(expect.arrayContaining(['Leo', 'Secret', 'Tray']));
  });

  it('draws for clients and guests only the characters they may see', () => {
    const names = drawn('client');
    expect(names).toContain('Leo');
    expect(names).not.toContain('Secret');
    expect(names).not.toContain('Tray');
  });
});
