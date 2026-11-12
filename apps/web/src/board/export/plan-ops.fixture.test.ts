import type { Element, PlanIcon, PlanShape } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { type CardContext, type Palette, planOps } from './board-render.ts';
import type { Op } from './pages.ts';

/**
 * The export's drawing of a sample plan, kept as a fixture (decision 0116): the operations were
 * written from `main` before the plan's geometry moved to canvas-core, and must stay the same.
 * Numbers are rounded to 1e-6 points, so a change in the order of floating-point steps passes
 * and any drawn difference fails. Rewrite with `vitest -u` only for a change meant to be seen.
 */

/** Every colour of the page a hex code of its own, so that the mixes show in the fixture. */
const colors = new Proxy({} as Palette, {
  get: (_, key) => {
    let h = 7;
    for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `#${(h & 0xffffff).toString(16).padStart(6, '0')}`;
  },
});
const ctx = {
  measure: (text: string, size: number) => text.length * size * 0.55,
  colors,
  noteBlocks: () => [],
  image: () => null,
  fileName: () => '',
  boardTitle: () => '',
} as unknown as CardContext;

const icon = (id: string, fields: Partial<PlanIcon>): PlanIcon =>
  ({ id: `icon${id.padEnd(9, 'A')}`, color: '#EDD963', x: 2048, y: 2048, ...fields }) as PlanIcon;
const shape = (id: string, fields: Partial<PlanShape>): PlanShape =>
  ({
    id: `shape${id.padEnd(8, 'A')}`,
    color: '#7AD689',
    width: 4,
    x0: 500,
    y0: 500,
    x1: 1300,
    y1: 1000,
    ...fields,
  }) as PlanShape;

/** Icons with every kind of glyph part, beam, glow, label and blocking. */
const ICONS: PlanIcon[] = [
  icon('cam', {
    kind: 'camera',
    color: '#9DB8F2',
    x: 600,
    y: 3200,
    rotation: 300,
    label: 'A cam',
    lens: 50,
    showLens: true,
    dashed: true,
    steps: [{ x: 300, y: 3600, rotation: 330 }, { x: 450, y: 3400, bend: 40 }],
  }),
  icon('fresnel', {
    kind: 'fresnel',
    x: 1200,
    y: 600,
    rotation: 45,
    label: 'Key',
    kelvin: 3200,
    intensity: 0.6,
    watts: 1200,
  }),
  icon('hmi', { kind: 'hmi', x: 3600, y: 700, rotation: 135, reach: 300, beam: 40 }),
  icon('lantern', { kind: 'lantern', x: 2048, y: 900 }),
  icon('floor', { kind: 'floorlamp', x: 3000, y: 1500, percent: 150 }),
  icon('street', { kind: 'streetlight', x: 3300, y: 3300, rotation: 90 }),
  icon('ring', { kind: 'ring', x: 1500, y: 1500, rotation: 200, color: '#F68186' }),
  icon('gel', { kind: 'gel', x: 1700, y: 700, rotation: 45, color: '#1C1C1E' }),
  icon('butterfly', { kind: 'butterfly', x: 2500, y: 2500, size: 'L', color: '#1C1C1E' }),
  icon('cuco', { kind: 'cuco', x: 2700, y: 600, rotation: 15, color: '#1C1C1E' }),
  icon('frame', { kind: 'frame', x: 900, y: 1800, color: '#1C1C1E' }),
  icon('drape', { kind: 'drape', x: 3800, y: 2000, rotation: 270, percent: 220 }),
  icon('table', { kind: 'table', x: 2200, y: 2000, w: 160, h: 90, rotation: 20, color: '#1C1C1E' }),
  icon('sofa', { kind: 'sofa', x: 2600, y: 3000, color: '#1C1C1E' }),
  icon('actor', {
    kind: 'actor',
    color: '#B897F0',
    x: 2100,
    y: 3500,
    rotation: 180,
    label: 'Anna',
    pose: 'seated',
    steps: [{ x: 1800, y: 3800 }],
  }),
  icon('lying', { kind: 'actor', color: '#B897F0', x: 3500, y: 3800, pose: 'lying', size: 'S' }),
  icon('monitor', { kind: 'monitor', color: '#60D8EB', x: 400, y: 400, rotation: 10 }),
  icon('custom', { kind: 'bounce', color: '#123456', x: 1000, y: 2600, rotation: 77 }),
];

/** Every kind of shape, level and turned, drawn both ways and measured. */
const SHAPES: PlanShape[] = [
  shape('rect', { kind: 'rect' }),
  shape('rectturn', { kind: 'rect', x0: 1600, y0: 2600, x1: 1100, y1: 2300, rotation: 30 }),
  shape('ellipse', { kind: 'ellipse', x0: 2600, y0: 1100, x1: 3100, y1: 1400 }),
  shape('ellturn', { kind: 'ellipse', x0: 3100, y0: 2300, x1: 3700, y1: 2700, rotation: 45 }),
  shape('line', { kind: 'line', x0: 200, y0: 2200, x1: 900, y1: 2900, width: 6 }),
  shape('arrow', { kind: 'arrow', x0: 1200, y0: 3000, x1: 1800, y1: 2700 }),
  shape('arrowfat', { kind: 'arrow', x0: 3900, y0: 400, x1: 3300, y1: 300, width: 10 }),
  shape('arrowturn', { kind: 'arrow', x0: 300, y0: 1000, x1: 700, y1: 1300, rotation: 60 }),
  shape('text', { kind: 'text', x0: 1400, y0: 3700, x1: 2000, y1: 3800, width: 18, text: 'Two\nlines' }),
  shape('textturn', { kind: 'text', x0: 2900, y0: 3600, x1: 3400, y1: 3700, width: 26, text: 'Turned', rotation: 340 }),
  shape('zone', { kind: 'zone', x0: 400, y0: 1300, x1: 1000, y1: 1700, text: 'Video village' }),
  shape('zonerev', { kind: 'zone', x0: 3900, y0: 3000, x1: 3300, y1: 2600, rotation: 15, text: 'Back' }),
  shape('measure', { kind: 'measure', x0: 400, y0: 3900, x1: 1600, y1: 3900 }),
  shape('meswritten', { kind: 'measure', x0: 3800, y0: 1000, x1: 3800, y1: 1800, text: '2.7', dashed: true }),
  shape('mesicons', { kind: 'measure', x0: 0, y0: 0, x1: 0, y1: 0, from: ICONS[3]?.id, to: ICONS[4]?.id }),
  shape('mesnone', { kind: 'measure', x0: 2000, y0: 200, x1: 2600, y1: 250, text: 'x' }),
];

const PLAN = {
  id: 'planAAAAAAAAA',
  type: 'plan',
  x: 0,
  y: 0,
  w: 600,
  h: 440,
  z: 'a1',
  parent: null,
  createdBy: null,
  createdAt: 0,
  icons: ICONS,
  shapes: SHAPES,
  strokes: [],
  scale: 80,
} as unknown as Extract<Element, { type: 'plan' }>;

const round = (v: unknown): unknown =>
  typeof v === 'number'
    ? Math.round(v * 1e6) / 1e6 + 0
    : Array.isArray(v)
      ? v.map(round)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
        : v;

/** One line per operation, a clip's operations after it, indented. */
function lines(ops: readonly Op[], depth = 0): string[] {
  return ops.flatMap((op) => {
    if (op.kind !== 'clip') return [`${' '.repeat(depth)}${JSON.stringify(round(op))}`];
    const { ops: inside, ...clip } = op;
    return [`${' '.repeat(depth)}${JSON.stringify(round(clip))}`, ...lines(inside, depth + 1)];
  });
}

describe('a set plan in exports', () => {
  it('draws the sample plan as it did before the geometry moved to canvas-core', async () => {
    const ops = planOps(PLAN, { x: 20, y: 30, w: 600, h: 400 }, ctx);
    await expect(`${lines(ops).join('\n')}\n`).toMatchFileSnapshot('./__fixtures__/plan-ops.txt');
  });

  it('draws a legend glyph, without beams and labels, as before', async () => {
    const ops = planOps(PLAN, { x: 0, y: 0, w: 120, h: 80 }, ctx, false, false);
    await expect(`${lines(ops).join('\n')}\n`).toMatchFileSnapshot(
      './__fixtures__/plan-ops-small.txt',
    );
  });
});
