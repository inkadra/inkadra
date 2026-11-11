// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { expect, it } from 'vitest';
import { elementSections, itemSummary, selectionMix } from './elements.ts';

const t = ((key: string, o?: { count?: number }) =>
  o?.count !== undefined
    ? `${o.count} ${key.split('.').at(-1)}`
    : key.split('.').at(-1)) as unknown as TFunction;
const icon = (id: string, kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: id.padEnd(13, 'A'),
  kind,
  color: '#EDD963',
  x: 1000,
  y: 1000,
  ...extra,
});
const key = icon('key', 'cob', { label: 'Key', watts: 300, stand: 'cstand' });
const plan = {
  icons: [
    key,
    icon('box', 'softbox', { on: key.id }),
    icon('cam', 'camera', {
      color: '#9DB8F2',
      lens: 32,
      support: 'dolly',
      steps: [{ x: 1, y: 1 }],
    }),
    icon('anna', 'actor', { color: '#B897F0', pose: 'seated' }),
    // Grip and crew: a flag (Lights layer) and the video village (Camera layer).
    icon('neg', 'flag'),
    icon('village', 'village', { color: '#9DB8F2' }),
    // A flag moved to the Set layer by hand is listed with the Set.
    icon('flag2', 'flag', { layer: 'set' }),
  ],
};

it('lists items by group, modifiers with their light, filtered by group and colour', () => {
  const all = elementSections(plan, { group: 'all', color: null });
  expect(all.map((s) => [s.group, s.items.map((e) => e.item.id.replace(/A+$/, ''))])).toEqual([
    ['lights', ['key']],
    ['camera', ['cam']],
    ['actors', ['anna']],
    ['grip', ['neg', 'village']],
    ['set', ['flag2']],
    ['notes', []],
  ]);
  expect(elementSections(plan, { group: 'grip', color: null })).toHaveLength(1);
  const yellow = elementSections(plan, { group: 'lights', color: '#EDD963' });
  expect(yellow.flatMap((s) => s.items).map((e) => e.item.id)).toEqual([key.id]);
});

it('sums up a light, a camera and a person in one line', () => {
  expect(itemSummary(key, plan.icons, t)).toBe('cob 300 W · softbox · cstand');
  expect(itemSummary(plan.icons[2] as PlanIcon, plan.icons, t)).toBe('32 mm · dolly · 2 positions');
  expect(itemSummary(plan.icons[3] as PlanIcon, plan.icons, t)).toBe('seated');
  expect(selectionMix(plan.icons.slice(0, 4), t)).toBe('2 lights, 1 camera, 1 actors');
});
