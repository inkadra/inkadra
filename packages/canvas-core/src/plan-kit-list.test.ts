// SPDX-License-Identifier: MPL-2.0

import type { PlanIcon } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import type { PlanElement } from './plan.ts';
import {
  circuitNames,
  familyKitCount,
  foldNames,
  kitList,
  planCounts,
  powerLines,
} from './plan-kit-list.ts';
import { english as t } from './plan-words.fixture.ts';
import type { Words } from './plan-words.ts';

/** The name and count of each line, what these tests are about. */
const lines = (kit: ReturnType<typeof kitList>) => kit.map(({ name, count }) => ({ name, count }));
/** The lines without their keys. */
const shown = (kit: ReturnType<typeof kitList>) => kit.map(({ key: _key, ...line }) => line);
const icon = (kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: `${kind}AAAAAAAAAAAA`.slice(0, 13),
  kind,
  color: '#1C1C1E',
  x: 0,
  y: 0,
  ...extra,
});

it('counts the kit of a plan by type and power, and nothing else', () => {
  const plan = {
    icons: [
      icon('fresnel', { power: '1,2K' }),
      icon('cstand'),
      icon('cstand'),
      icon('fresnel', { power: '650' }),
      icon('cstand'),
      icon('actor'),
      icon('sofa'),
      icon('dolly'),
    ],
  };
  expect(lines(kitList(plan, t))).toEqual([
    { name: 'Fresnel 1,2K', count: 1 },
    { name: 'C-stand', count: 3 },
    { name: 'Fresnel 650', count: 1 },
    { name: 'Dolly', count: 1 },
  ]);
  expect(lines(kitList({ ...plan, hiddenLayers: ['lights'] }, t))).toEqual([
    { name: 'Dolly', count: 1 },
  ]);
  // With a scale, a track says how long it is.
  const track = icon('track', { w: 300, h: 40 });
  expect(lines(kitList({ icons: [track], scale: 100 }, t, 'it'))).toEqual([
    { name: 'Track 3 m', count: 1 },
  ]);
});

it('counts watts, modifiers, gels and the stands named on lights (decision 0104)', () => {
  const plan = {
    icons: [
      icon('cob', { id: 'cobAAAAAAAAAA', watts: 300, gel: 'CTO ½', stand: 'combo' }),
      icon('softbox', { id: 'boxAAAAAAAAAA', on: 'cobAAAAAAAAAA' }),
      icon('led', { id: 'ledAAAAAAAAAA', gel: 'CTO ½', stand: 'cstand', on: 'standAAAAAAAA' }),
      icon('cstand', { id: 'standAAAAAAAA' }),
      icon('camera', { id: 'camAAAAAAAAAA', support: 'tripod' }),
      icon('crew'),
    ],
  };
  expect(lines(kitList(plan, t))).toEqual([
    { name: 'LED COB 300 W', count: 1 },
    { name: 'LED panel', count: 1 },
    { name: 'C-stand', count: 1 },
    { name: 'Camera', count: 1 },
    { name: 'Softbox', count: 1 },
    { name: 'Gel: CTO ½', count: 2 },
    { name: 'Combo stand', count: 1 },
    { name: 'Tripod', count: 1 },
  ]);
});

it('sorts each line into its section, with the watts of a light each', () => {
  const kit = kitList(
    {
      icons: [
        icon('fresnel', { watts: 2000 }),
        icon('flag'),
        icon('camera', { support: 'tripod' }),
      ],
    },
    t,
  );
  expect(shown(kit)).toEqual([
    { name: 'Fresnel 2K', count: 1, group: 'lights', watts: 2000 },
    { name: 'Flag', count: 1, group: 'grip' },
    { name: 'Camera', count: 1, group: 'camera' },
    { name: 'Tripod', count: 1, group: 'camera' },
  ]);
});

it('prints the power per circuit, computed from the lights', () => {
  const plan = {
    voltage: 230 as const,
    circuits: [{ id: 'circuitAAAAAA', name: 'A', amps: 16 }],
    icons: [
      icon('fresnel', { label: 'Key', watts: 2000, circuit: 'circuitAAAAAA' }),
      { ...icon('cob', { watts: 300 }), id: 'cobBBBBBBBBBB' },
    ],
  };
  expect(powerLines(plan, t, 'en')).toEqual({
    title: 'Power at 230 V',
    total: '2.3 kW · 10 A',
    rows: [
      { text: 'A · 16 A: Key', amps: '8.7 A', status: 'ok' },
      { text: 'On no circuit: LED COB', amps: '1.3 A', status: 'ok' },
    ],
  });
  expect(powerLines({ icons: [icon('chair')] }, t, 'en')).toBeNull();
});

it('puts the modifiers of a light on one line, every gel on one, video under camera', () => {
  const plan = {
    icons: [
      icon('cob', { id: 'keyAAAAAAAAAA', watts: 300, gel: '216' }),
      icon('softbox', { id: 'boxAAAAAAAAAA', on: 'keyAAAAAAAAAA' }),
      icon('grid', { id: 'gridAAAAAAAAA', on: 'keyAAAAAAAAAA' }),
      icon('fresnel', { id: 'sodAAAAAAAAAA', watts: 1200, gel: 'CTO full' }),
      icon('flag', { id: 'flagAAAAAAAAA' }),
      icon('village', { id: 'villAAAAAAAAA' }),
    ],
  };
  expect(shown(kitList(plan, t, 'en'))).toEqual([
    { name: 'LED COB 300 W', count: 1, group: 'lights', watts: 300 },
    { name: 'Fresnel 1.2K', count: 1, group: 'lights', watts: 1200 },
    { name: 'Flag', count: 1, group: 'grip' },
    { name: 'Video village', count: 1, group: 'camera' },
    { name: 'Softbox, Grid', count: 1, group: 'grip' },
    { name: 'Gel: 216, CTO full', count: 2, group: 'grip' },
  ]);
});

it('counts all setups as the most any one needs, not their sum (decision 0117)', () => {
  const base = {
    id: 'baseAAAAAAAAA',
    type: 'plan',
    createdAt: 1,
    icons: [icon('fresnel', { watts: 2000 }), icon('cob', { watts: 300 })],
  } as unknown as PlanElement;
  const setup = {
    ...base,
    id: 'setupAAAAAAAA',
    variantOf: base.id,
    createdAt: 2,
    icons: [icon('fresnel', { watts: 2000 }), icon('flag')],
  } as unknown as PlanElement;
  // The Fresnel moves from one setup to the next: one, not two.
  expect(familyKitCount([base, setup], t, 'en')).toBe(3);
  const named = (names: string[]) => names.map((n) => ({ key: n, name: n }));
  expect(foldNames(named(['Key', 'Practical', 'Hair', 'Practical', 'Practical']))).toBe(
    'Key, Practical ×3, Hair',
  );
});

it('leaves the sun and the other sources that are no kit out of the kit and the power', () => {
  const plan = {
    icons: [
      icon('sun', { watts: 5000 }),
      icon('moon'),
      icon('fire'),
      icon('candle'),
      icon('screen'),
      icon('neon'),
      icon('headlights'),
      icon('streetlight'),
      // Practicals are kit: a table, a ceiling and a floor lamp.
      icon('practical', { watts: 60 }),
      icon('pendant'),
      icon('floorlamp'),
    ],
  };
  expect(lines(kitList(plan, t)).map((l) => l.name)).toEqual([
    'Table lamp 60 W',
    'Ceiling lamp',
    'Floor lamp',
  ]);
  const power = powerLines(plan, t, 'en');
  expect(power?.rows.map((r) => r.text)).toEqual([
    'On no circuit: Table lamp, Ceiling lamp, Floor lamp',
  ]);
  expect(powerLines({ icons: [icon('sun', { watts: 5000 })] }, t, 'en')).toBeNull();
});

it("counts the card's lights by the kit's rule: a sun is no light to bring", () => {
  const fresnel = icon('fresnel', { watts: 2000 });
  expect(planCounts({ icons: [icon('sun'), fresnel] })).toEqual({
    cameras: 0,
    lights: 1,
    watts: 2000,
  });
  expect(planCounts({ icons: [icon('sun')] })).toMatchObject({ lights: 0, watts: 0 });
});

it('counts what an item is, not how a language writes it (decision 0116)', () => {
  // A catalogue that calls a Fresnel and an open face both "Spot": still two lines, two kinds.
  const spot = ((key: string, values?: Record<string, unknown>) =>
    /\.(fresnel|openface)$/.test(key) ? 'Spot' : t(key, values)) as Words;
  const plan = {
    icons: [
      icon('fresnel', { id: 'fresnelAAAAAA', watts: 1000 }),
      icon('openface', { id: 'openfaceAAAAA', watts: 1000 }),
      icon('fresnel', { id: 'fresnelBBBBBB', power: '1K' }),
    ],
  };
  const kit = kitList(plan, spot, 'en');
  // "1K" typed and 1000 W are the same spec: one line of two Fresnels.
  expect(kit.map(({ key, name, count }) => [key, name, count])).toEqual([
    ['icon:fresnel:1K:', 'Spot 1K', 2],
    ['icon:openface:1K:', 'Spot 1K', 1],
  ]);
  // The same lines in every language.
  expect(kitList(plan, t, 'en').map((l) => [l.key, l.count])).toEqual(
    kit.map((l) => [l.key, l.count]),
  );
  // A setup with one open face more: the most of each kind, whatever they are called.
  const base = {
    id: 'baseAAAAAAAAA',
    type: 'plan',
    createdAt: 1,
    ...plan,
  } as unknown as PlanElement;
  const setup = {
    id: 'setupAAAAAAAA',
    type: 'plan',
    createdAt: 2,
    variantOf: base.id,
    icons: [icon('openface', { watts: 1000 }), icon('openface', { watts: 1000 })],
  } as unknown as PlanElement;
  expect(familyKitCount([base, setup], spot, 'en')).toBe(4);
  // On a circuit, two kinds that read the same are named twice, not folded into "Spot ×2".
  expect(circuitNames(['fresnelAAAAAA', 'openfaceAAAAA', 'fresnelBBBBBB'], plan.icons, spot)).toBe(
    'Spot ×2, Spot',
  );
});
