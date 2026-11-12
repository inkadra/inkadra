import { readFileSync, writeFileSync } from 'node:fs';
import {
  type Element,
  PLAN_ICON_KINDS,
  type PlanIcon,
  type PlanShape,
  type PlanStroke,
} from '@inkadra/doc-schema';
import { expect } from 'vitest';

/**
 * A sample set plan with every kind of glyph part, beam, glow, label, blocking and shape, level
 * and turned: the fixtures of the export's operations and of the board's SVG are drawn from it
 * (decision 0116).
 */
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
export const ICONS: PlanIcon[] = [
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
    steps: [
      { x: 300, y: 3600, rotation: 330 },
      { x: 450, y: 3400, bend: 40 },
    ],
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
export const SHAPES: PlanShape[] = [
  shape('rect', { kind: 'rect' }),
  shape('rectturn', { kind: 'rect', x0: 1600, y0: 2600, x1: 1100, y1: 2300, rotation: 30 }),
  shape('ellipse', { kind: 'ellipse', x0: 2600, y0: 1100, x1: 3100, y1: 1400 }),
  shape('ellturn', { kind: 'ellipse', x0: 3100, y0: 2300, x1: 3700, y1: 2700, rotation: 45 }),
  shape('line', { kind: 'line', x0: 200, y0: 2200, x1: 900, y1: 2900, width: 6 }),
  shape('arrow', { kind: 'arrow', x0: 1200, y0: 3000, x1: 1800, y1: 2700 }),
  shape('arrowfat', { kind: 'arrow', x0: 3900, y0: 400, x1: 3300, y1: 300, width: 10 }),
  shape('arrowturn', { kind: 'arrow', x0: 300, y0: 1000, x1: 700, y1: 1300, rotation: 60 }),
  shape('text', {
    kind: 'text',
    x0: 1400,
    y0: 3700,
    x1: 2000,
    y1: 3800,
    width: 18,
    text: 'Two\nlines',
  }),
  shape('textturn', {
    kind: 'text',
    x0: 2900,
    y0: 3600,
    x1: 3400,
    y1: 3700,
    width: 26,
    text: 'Turned',
    rotation: 340,
  }),
  shape('zone', { kind: 'zone', x0: 400, y0: 1300, x1: 1000, y1: 1700, text: 'Video village' }),
  shape('zonerev', {
    kind: 'zone',
    x0: 3900,
    y0: 3000,
    x1: 3300,
    y1: 2600,
    rotation: 15,
    text: 'Back',
  }),
  shape('measure', { kind: 'measure', x0: 400, y0: 3900, x1: 1600, y1: 3900 }),
  shape('meswritten', {
    kind: 'measure',
    x0: 3800,
    y0: 1000,
    x1: 3800,
    y1: 1800,
    text: '2.7',
    dashed: true,
  }),
  shape('mesicons', {
    kind: 'measure',
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    from: ICONS[3]?.id,
    to: ICONS[4]?.id,
  }),
  shape('mesnone', { kind: 'measure', x0: 2000, y0: 200, x1: 2600, y1: 250, text: 'x' }),
];

/** A closed room and a loose wall, with every kind of opening, both sides and hinges. */
const WALLS = [
  {
    id: 'wallAAAAAAAAA',
    points: [300, 300, 3200, 300, 3200, 2400, 300, 2400],
    thickness: 12,
    closed: true,
  },
  { id: 'wallBBBBBBBBB', points: [3500, 300, 3500, 3000, 3900, 3500], thickness: 8 },
];
const OPENINGS = [
  { id: 'openAAAAAAAAA', wall: 'wallAAAAAAAAA', kind: 'door', at: 150, width: 60 },
  {
    id: 'openBBBBBBBBB',
    wall: 'wallAAAAAAAAA',
    kind: 'doubledoor',
    at: 900,
    width: 110,
    side: 'right',
    hinge: 'end',
  },
  { id: 'openCCCCCCCCC', wall: 'wallAAAAAAAAA', kind: 'sliding', at: 400, width: 80 },
  { id: 'openDDDDDDDDD', wall: 'wallAAAAAAAAA', kind: 'window', at: 1600, width: 90 },
  { id: 'openEEEEEEEEE', wall: 'wallBBBBBBBBB', kind: 'opening', at: 250, width: 70 },
];
/** A pencil line and a see-through marker stroke. */
const STROKES: PlanStroke[] = [
  {
    id: 'strokeAAAAAAA',
    tool: 'pencil',
    color: '#1C1C1E',
    width: 3,
    points: [200, 3000, 400, 3100, 700, 3050, 900, 3300],
  },
  {
    id: 'strokeBBBBBBB',
    tool: 'marker',
    color: '#F79B54',
    width: 12,
    points: [2500, 3900, 3000, 3700, 3400, 3950],
  },
];

export const PLAN = {
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
  strokes: STROKES,
  walls: WALLS,
  openings: OPENINGS,
  background: { assetId: 'assetAAAAAAAA', x: -60, y: -40, w: 1100, h: 760, opacity: 0.4, grey: true },
  scale: 80,
} as unknown as Extract<Element, { type: 'plan' }>;

/** The sample with its Set and Notes layers hidden: no walls, no set items, no zones. */
export const PLAN_HIDDEN = { ...PLAN, hiddenLayers: ['set', 'notes'] } as typeof PLAN;

/** Every kind of the catalogue, on a grid, each turned and coloured its own way. */
export const CATALOGUE = {
  ...PLAN,
  id: 'planCCCCCCCCC',
  shapes: [],
  strokes: [],
  walls: [],
  openings: [],
  icons: PLAN_ICON_KINDS.map((kind, i) =>
    icon(`k${i}`, {
      kind,
      x: 150 + (i % 16) * 250,
      y: 150 + Math.floor(i / 16) * 330,
      rotation: (i * 37) % 360,
      color: ['#EDD963', '#9DB8F2', '#60D8EB', '#B897F0', '#1C1C1E', '#F68186'][i % 6],
      ...(i % 5 === 0 ? { percent: 60 } : {}),
    }),
  ),
} as typeof PLAN;

/** A setup of the sample: the base's Set layer under its own camera (decision 0062). */
export const SETUP = {
  ...PLAN,
  id: 'planSSSSSSSSS',
  variantOf: PLAN.id,
  variant: 'Evening',
  shapes: [],
  strokes: [],
  walls: [],
  openings: [],
  icons: [icon('setupcam', { kind: 'camera', color: '#9DB8F2', x: 3000, y: 1800, rotation: 200 })],
} as typeof PLAN;

/**
 * Lines, arrows and measures with a rotation: the editor never writes one (it turns their ends),
 * but a document may hold one; the board draws them turned.
 */
export const TURNED = {
  ...PLAN,
  id: 'planTTTTTTTTT',
  icons: [],
  strokes: [],
  walls: [],
  openings: [],
  shapes: [
    shape('tline', { kind: 'line', x0: 200, y0: 2200, x1: 900, y1: 2900, width: 6, rotation: 25 }),
    shape('tarrow', { kind: 'arrow', x0: 300, y0: 1000, x1: 700, y1: 1300, rotation: 60 }),
    shape('tarrowfat', { kind: 'arrow', x0: 3900, y0: 400, x1: 3300, y1: 300, width: 10, rotation: 300 }),
    shape('tmeasure', { kind: 'measure', x0: 400, y0: 3900, x1: 1600, y1: 3700, rotation: 30 }),
    shape('tmesdash', {
      kind: 'measure',
      x0: 3800,
      y0: 1000,
      x1: 3600,
      y1: 1800,
      text: '2.7',
      dashed: true,
      rotation: 200,
    }),
  ],
} as typeof PLAN;

const NUMBER = /-?\d+(?:\.\d+)?(?:e-?\d+)?/g;

/**
 * Checks `text` against the fixture at `path`: the same text, its numbers within 1e-5 (a value on
 * a rounding boundary of the written digits may round either way from floating-point noise).
 * `WRITE_PLAN_FIXTURES=1` writes the fixture instead, for a change meant to be seen.
 */
export function expectFixture(text: string, path: string): void {
  if (process.env.WRITE_PLAN_FIXTURES) {
    writeFileSync(path, text);
    return;
  }
  const fixture = readFileSync(path, 'utf8');
  const words = (t: string) => t.split(NUMBER);
  const numbers = (t: string) => (t.match(NUMBER) ?? []).map(Number);
  const a = numbers(text);
  const b = numbers(fixture);
  const same =
    words(text).join('#') === words(fixture).join('#') &&
    a.length === b.length &&
    a.every((v, i) => Math.abs(v - (b[i] as number)) <= 1e-5);
  // On a difference, the whole texts, for the diff.
  if (!same) expect(text).toBe(fixture);
}
