// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanElement } from '@inkadra/canvas-core';
import { light } from '@inkadra/ui/tokens';
import type { TFunction } from 'i18next';
import { expect, it } from 'vitest';
import type { CardContext } from './board-render.ts';
import { greyPixels } from './images.ts';
import type { Op } from './pages.ts';
import {
  PLAN_SHEET_FRAME,
  PLAN_SHEET_INCLUDE,
  planSheetPages,
  previewCrop,
  roomSize,
  sheetInclude,
} from './plan-sheet.ts';

const ctx: CardContext = {
  measure: (value, size) => [...value].length * size * 0.5,
  colors: light,
  noteBlocks: () => [],
  image: (id) => (id ? { key: id, info: { width: 3, height: 2 } } : null),
  fileName: () => '',
  boardTitle: () => '',
  frameLabel: () => '',
  frameAspect: () => 16 / 9,
  frameMeta: () => '',
  slugline: () => '',
  characterLine: () => '',
  storyMeta: () => '',
  words: { board: 'Board', file: 'File', plan: 'Set plan' },
  language: 'en',
};
const t = ((key: string, o?: Record<string, unknown>) =>
  o
    ? `${key.split('.').at(-1)}(${Object.values(o).join(',')})`
    : key.split('.').at(-1)) as unknown as TFunction;
const texts = (ops: readonly Op[]): string[] =>
  ops.flatMap((op) => (op.kind === 'text' ? [op.text] : op.kind === 'clip' ? texts(op.ops) : []));
const plan = {
  id: 'planAAAAAAAAA',
  type: 'plan',
  x: 0,
  y: 0,
  w: 400,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: 1,
  scale: 100,
  walls: [{ id: 'wallAAAAAAAAA', points: [0, 0, 5000, 0, 5000, 3000], thickness: 10 }],
  circuits: [{ id: 'circuitAAAAAA', name: 'A', amps: 16 }],
  icons: [
    {
      id: 'camAAAAAAAAAA',
      kind: 'camera',
      color: '#9DB8F2',
      x: 100,
      y: 100,
      label: 'A cam',
      lens: 32,
    },
    {
      id: 'keyAAAAAAAAAA',
      kind: 'fresnel',
      color: '#EDD963',
      x: 900,
      y: 900,
      label: 'Key',
      watts: 2000,
      kelvin: 3200,
      circuit: 'circuitAAAAAA',
      note: 'off the back wall',
    },
    { id: 'leoAAAAAAAAAA', kind: 'actor', color: '#F79B54', x: 500, y: 500, label: 'Leo' },
  ],
} as unknown as PlanElement;

it('prints one A4 landscape page per setup with the title block, legend, power and notes', () => {
  const pages = planSheetPages(
    {
      setups: [
        { plan, name: 'Setup 1 · Base', shots: ['2A', '2B'] },
        { plan, name: 'Setup 2 · CU', shots: [] },
      ],
      scene: 'Scene 2 · INT. DINER',
      place: 'Rosa diner · Day 3',
      area: null,
      include: PLAN_SHEET_INCLUDE,
      t,
      locale: 'en',
    },
    ctx,
  );
  expect(pages).toHaveLength(2);
  expect(Math.round(pages[0]?.width ?? 0)).toBe(842);
  expect(Math.round(pages[0]?.height ?? 0)).toBe(595);
  const words = texts(pages[0]?.ops ?? []);
  for (const expected of [
    'NAME · SCENE 2 · INT. DINER',
    'Setup 1 · Base',
    '2A, 2B',
    'A cam',
    '32 mm',
    '3200 K',
    'Leo',
    'POWERAT(230)',
    'Rosa diner · Day 3',
    'foot(1,2)',
  ])
    expect(words.join('|')).toContain(expected);
  expect(words.join('|')).toContain('off the back wall');
  // The lens once, at the right of the camera's row; the legend's glyph draws no "2000 W" of its
  // own over itself (the drawing's label is "Key · 2000 W").
  expect(words.filter((w) => w.includes('32 mm'))).toEqual(['32 mm']);
  expect(words).not.toContain('2000 W');
  // Without the legend, the power and the notes, none of them.
  const bare = texts(
    planSheetPages(
      {
        setups: [{ plan, name: 'Setup 1', shots: [] }],
        scene: '',
        place: '',
        area: null,
        include: { ...PLAN_SHEET_INCLUDE, legend: false, power: false, notes: false },
        t,
        locale: 'en',
      },
      ctx,
    )[0]?.ops ?? [],
  ).join('|');
  expect(bare).not.toContain('POWERAT');
  expect(bare).not.toContain('off the back wall');
  expect(bare).not.toContain('CAMERAS');
});

it('measures the room from the walls, in metres', () => {
  // 5000 × 3000 of STROKE_GRID over a 1000 × 666.7 view at 100 units per metre.
  expect(roomSize(plan, 'en')).toMatch(/^\d+\.\d × \d+\.\d m$/);
  expect(roomSize({ ...plan, scale: undefined }, 'en')).toBeNull();
});

it('lists the shots without empty labels', () => {
  const [page] = planSheetPages(
    {
      setups: [{ plan, name: 'Setup 1', shots: ['2A', '', '2B'] }],
      scene: '',
      place: '',
      area: null,
      include: PLAN_SHEET_INCLUDE,
      t,
      locale: 'en',
    },
    ctx,
  );
  const words = texts(page?.ops ?? []);
  expect(words).toContain('2A, 2B');
  expect(words.join('|')).not.toContain(', ,');
});

it('draws the background where it was placed, at its opacity, in greys, and not when hidden', () => {
  const images = (ops: readonly Op[]): Array<Extract<Op, { kind: 'image' }>> =>
    ops.flatMap((op) => (op.kind === 'image' ? [op] : op.kind === 'clip' ? images(op.ops) : []));
  // The old extent shown, so that where the picture lies can be compared (decision 0118).
  const sheet = (background: PlanElement['background'], hidden?: PlanElement['hiddenLayers']) =>
    images(
      planSheetPages(
        {
          setups: [{ plan: { ...plan, background, hiddenLayers: hidden }, name: 'S', shots: [] }],
          scene: '',
          place: '',
          area: { x: 0, y: 0, w: 1000, h: 1000 / 1.5 },
          include: { ...PLAN_SHEET_INCLUDE, background: true },
          t,
          locale: 'en',
        },
        ctx,
      )[0]?.ops ?? [],
    );
  const whole = sheet({ assetId: 'pic', opacity: 0.4 })[0];
  const placed = sheet({ assetId: 'pic', opacity: 0.4, grey: true, x: 0, y: 0, w: 500, h: 250 })[0];
  // Placed: half as wide as the drawing, from its corner; faded and grey.
  expect(placed?.w).toBeCloseTo((whole?.w ?? 0) / 2, 3);
  expect([placed?.x, placed?.y]).toEqual([whole?.x, whole?.y]);
  expect([placed?.opacity, placed?.grey]).toEqual([0.4, true]);
  expect(whole?.grey).toBeUndefined();
  expect(sheet({ assetId: 'pic', hidden: true })).toHaveLength(0);
  expect(sheet({ assetId: 'pic' }, ['set'])).toHaveLength(0);
});

it('turns pixels to greys by their luma, alpha kept', () => {
  const px = greyPixels(new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 255]));
  expect([...px]).toEqual([76, 76, 76, 128, 150, 150, 150, 255]);
});

it('includes the background by default when the plan shows one, and prints it grey if grey', () => {
  expect(sheetInclude({}).background).toBe(false);
  expect(sheetInclude({ background: { assetId: 'pic', hidden: true } }).background).toBe(false);
  const include = sheetInclude({ background: { assetId: 'pic', grey: true } });
  expect(include).toEqual({ ...PLAN_SHEET_INCLUDE, background: true });
  const [image] = planSheetPages(
    {
      setups: [
        { plan: { ...plan, background: { assetId: 'pic', grey: true } }, name: 'S', shots: [] },
      ],
      scene: '',
      place: '',
      area: null,
      include,
      t,
      locale: 'en',
    },
    ctx,
  )
    .flatMap((page) => page.ops.flatMap((op) => (op.kind === 'clip' ? op.ops : [op])))
    .filter((op) => op.kind === 'image');
  expect(image).toMatchObject({ key: 'pic', grey: true });
});

it('crops the preview to the drawing: the frame fills the preview, sharp at the pixel ratio', () => {
  const page = { width: 842, height: 595 };
  const frame = { x: 24, y: 76, w: 480, h: 477 };
  // 240 css px for 480 points, at 2 device pixels per css pixel: 1 device pixel per point.
  expect(previewCrop(page, frame, 240, 2)).toEqual({
    scale: 1,
    page: { w: 842, h: 595 },
    from: { x: 24, y: 76 },
    size: { w: 480, h: 477 },
  });
  const half = previewCrop(page, frame, 240, 1);
  expect(half.size).toEqual({ w: 240, h: 239 });
  expect(half.from).toEqual({ x: 12, y: 38 });
  // Not laid out yet, or no ratio known: the dialog's 232 px at 1.
  expect(previewCrop(page, frame, 0, 0).size.w).toBe(232);
  // The crop never leaves the page: the sheet's own frame lies inside it.
  const sheet = previewCrop(page, PLAN_SHEET_FRAME, 232, 3);
  expect(sheet.from.x + sheet.size.w).toBeLessThanOrEqual(sheet.page.w);
  expect(sheet.from.y + sheet.size.h).toBeLessThanOrEqual(sheet.page.h);
});

it('fills the drawing frame with what is drawn, in the frame’s own shape (decision 0119)', () => {
  const [page] = planSheetPages(
    {
      setups: [{ plan, name: 'Setup 1', shots: [] }],
      scene: '',
      place: '',
      area: null,
      include: PLAN_SHEET_INCLUDE,
      t,
      locale: 'en',
    },
    ctx,
  );
  const ops = page?.ops ?? [];
  // The frame is the rounded rect; the drawing is the clip inside it.
  const frame = ops.find((o) => o.kind === 'rect' && o.radius === 6) as Extract<
    Op,
    { kind: 'rect' }
  >;
  const drawing = ops.find((o) => o.kind === 'clip') as Extract<Op, { kind: 'clip' }>;
  expect(drawing.w).toBeCloseTo(frame.w - 16, 0);
  expect(drawing.h).toBeCloseTo(frame.h - 16, 0);
});
