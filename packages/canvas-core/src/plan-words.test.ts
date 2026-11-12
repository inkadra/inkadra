// SPDX-License-Identifier: MPL-2.0
import {
  type Element,
  PLAN_CAMERA_SUPPORTS,
  PLAN_ICON_KINDS,
  PLAN_LIGHT_STANDS,
  type PlanIcon,
  type PlanShape,
  PlanShape as PlanShapeSchema,
  STROKE_GRID,
} from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import type { PlanElement } from './plan.ts';
import {
  elementSections,
  itemName,
  itemSummary,
  legendLine,
  legendRow,
  legendValue,
  planLegend,
} from './plan-elements.ts';
import { familyKitCount, kitList, powerLines, powerText } from './plan-kit-list.ts';
import { planCardWords, scenesOfPlan, setupName, shotSetups } from './plan-setups.ts';
import { roomSize, roomSizeText } from './plan-walls.ts';
import { english } from './plan-words.fixture.ts';
import { PLAN_WORDS_EN } from './plan-words.ts';

const icon = (id: string, kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: id.padEnd(13, 'A'),
  kind,
  color: '#EDD963',
  x: 1000,
  y: 1000,
  ...extra,
});
const card = { x: 0, y: 0, w: 100, z: 'a0', parent: null, createdBy: null };
const icons = [
  icon('acam', 'camera', { label: 'A cam', lens: 50 }),
  icon('bcam', 'camera', { label: 'B cam', lens: 85 }),
  icon('key', 'fresnel', { label: 'Key', watts: 1000, kelvin: 5600, intensity: 0.6 }),
  icon('fill', 'cob', { watts: 300 }),
  icon('anna', 'actor', { label: 'Anna' }),
];
const base = {
  ...card,
  id: 'baseAAAAAAAAA',
  type: 'plan',
  createdAt: 1,
  title: 'Diner',
  sceneIds: ['sceneAAAAAAAA', 'goneAAAAAAAAA'],
  icons,
} as unknown as PlanElement;
const night = {
  ...card,
  id: 'nightAAAAAAAA',
  type: 'plan',
  createdAt: 2,
  variantOf: base.id,
  variant: 'Night',
  icons: [],
} as unknown as PlanElement;
const scene = { ...card, id: 'sceneAAAAAAAA', type: 'scene', createdAt: 0, number: '5' };
const byId = new Map<string, Element>(
  [base, night, scene as unknown as Element].map((e) => [e.id, e as Element]),
);

it('names every icon of the catalogue in English', () => {
  const names = PLAN_WORDS_EN.board.plan.icons as Record<string, string>;
  expect(PLAN_ICON_KINDS.filter((k) => !names[k])).toEqual([]);
});

it("writes a plan's card, setups, kit and power in English with the shared words", () => {
  const words = planCardWords(base, byId, english, 'en');
  expect(words.title).toBe('Diner');
  expect(words.chips).toEqual(['2 setups', '2 cameras', '2 lights · 1.3 kW']);
  expect(scenesOfPlan(base, byId).map((s) => s.id)).toEqual(['sceneAAAAAAAA']);
  expect(planCardWords(night, byId, english, 'en').title).toBe('Diner · Night');
  expect(setupName(base, [base, night], english)).toBe('1 · Base');
  expect(setupName({ ...night, variant: undefined }, [base, night], english)).toBe('2 · Variant');

  expect(kitList(base, english, 'en').map((l) => `${l.name} ×${l.count}`)).toEqual([
    'Camera ×2',
    'Fresnel 1K ×1',
    'LED COB 300 W ×1',
  ]);
  expect(powerLines(base, english, 'en')).toEqual({
    title: 'Power at 230 V',
    total: '1.3 kW · 5.7 A',
    rows: [{ text: 'On no circuit: Key, LED COB', amps: '5.7 A', status: 'ok' }],
  });
  expect(powerText(1300, 5.7, 'it')).toBe('1,3 kW · 5,7 A');
});

it('lists the legend as the view and the PDF sheet print it', () => {
  const legend = planLegend({ ...base, hiddenLayers: ['actors'] });
  expect(legend.cameras.map((i) => i.label)).toEqual(['A cam', 'B cam']);
  expect(legend.lights.map((i) => i.kind)).toEqual(['fresnel', 'cob']);
  // A hidden layer is left out of the legend.
  expect(legend.cast).toEqual([]);
  expect(planLegend(base).cast.map((i) => i.label)).toEqual(['Anna']);

  const [cam, , key] = icons as [PlanIcon, PlanIcon, PlanIcon];
  expect(legendRow(cam, 1, icons, english, { locale: 'en' })).toEqual({
    name: 'A cam · 50 mm',
    sub: '',
  });
  expect(legendRow(key, 2, icons, english, { locale: 'en' })).toEqual({
    name: 'Key ×2',
    sub: 'Fresnel 1K · 5600 K',
  });
  expect(legendLine(cam, icons, english, 'en')).toBe('A cam');
  expect(legendLine(key, icons, english, 'en')).toBe('Key · Fresnel 1K');
  expect(legendValue(cam)).toBe('50 mm');
  expect(legendValue(key)).toBe('5600 K · 60%');
  expect(roomSizeText(800, 100, true, english, 'en')).toBe('8.0 m overall');
});

it('carries every word the shared functions ask for: one plan with one of everything', () => {
  // `english` throws on a key PLAN_WORDS_EN does not carry: every branch below asks for one.
  const track = icon('track', 'track', { w: 280, h: 20 });
  const dolly = icon('dolly', 'dolly', { on: track.id });
  const all: PlanIcon[] = [
    track,
    dolly,
    icon('cam', 'camera', {
      lens: 32,
      on: dolly.id,
      frameId: 'frameAAAAAAAA',
      steps: [{ x: 1, y: 1 }],
    }),
    icon('light', 'cob', { label: 'Key', watts: 300, gel: '216', circuit: 'circuitAAAAAA' }),
    icon('box', 'softbox', { on: 'lightAAAAAAAA' }),
    icon('far', 'fresnel', { power: '2K', kelvin: 3200, intensity: 0.5 }),
    icon('frame', 'frame', { w: 100, h: 100 }),
    icon('extra', 'actor', { steps: [{ x: 2, y: 2, note: 'to the door' }], stepNote: 'sits' }),
    icon('table', 'table'),
    ...PLAN_LIGHT_STANDS.map((stand) => icon(`s${stand}`, 'led', { stand, watts: 100 })),
    ...PLAN_CAMERA_SUPPORTS.map((support) => icon(`c${support}`, 'camera', { support })),
    ...(['seated', 'lying'] as const).map((pose) => icon(`p${pose}`, 'actor', { pose })),
    ...PLAN_ICON_KINDS.map((kind) => icon(`k${kind}`, kind, { x: 3000 })),
  ];
  const shapes: PlanShape[] = PlanShapeSchema.shape.kind.options.map((kind) => ({
    id: `shape${kind}`.padEnd(13, 'A'),
    kind,
    color: '#1C1C1E',
    width: 4,
    x0: 0,
    y0: 0,
    x1: STROKE_GRID / 2,
    y1: STROKE_GRID / 2,
  }));
  const plan = {
    ...base,
    scale: 70,
    icons: all,
    shapes,
    strokes: [{ id: 'strokeAAAAAAA', color: '#1C1C1E', width: 4, points: [0, 0, 10, 10] }],
    walls: [{ id: 'wallAAAAAAAAA', points: [0, 0, 2000, 0, 2000, 2000, 0, 2000], closed: true }],
    circuits: [{ id: 'circuitAAAAAA', name: 'A', amps: 16 }],
  } as unknown as PlanElement;
  const setup = { ...night, icons: all } as unknown as PlanElement;
  const frame = { ...card, id: 'frameAAAAAAAA', type: 'frame', createdAt: 0 } as unknown as Element;
  const cards = new Map<string, Element>(
    [plan, setup, frame, scene as unknown as Element].map((e) => [e.id, e as Element]),
  );

  expect(() => {
    kitList(plan, english, 'en');
    familyKitCount([plan, setup], english, 'en');
    powerLines(plan, english, 'en');
    planCardWords(plan, cards, english, 'en');
    planCardWords(setup, cards, english, 'en');
    shotSetups([...cards.values()], english);
    setupName(setup, [plan, { ...setup, variant: undefined }], english);
    for (const section of elementSections(plan, { group: 'all', color: null }))
      for (const row of section.items) itemName(row.item, english);
    itemName(plan.strokes?.[0] as never, english);
    for (const i of all) {
      itemSummary(i, all, english, { scale: 70, locale: 'en' });
      itemSummary(i, all, english, { locale: 'en' });
      legendRow(i, 2, all, english, { scale: 70, locale: 'en' });
      legendLine(i, all, english, 'en');
    }
    roomSizeText(800, 70, true, english, 'en');
  }).not.toThrow();
  expect(itemName(plan.strokes?.[0] as never, english)).toBe('Pencil');
  expect(roomSize(plan, 'en')).toMatch(/^\d+\.\d × \d+\.\d m$/);
});
