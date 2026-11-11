// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { expect, it } from 'vitest';
import { elementSections, itemSummary, selectionMix } from './elements.ts';

const t = ((key: string, o?: { count?: number }) =>
  o?.count !== undefined ? `${o.count} ${key.split('.').at(-1)}` : key.split('.').at(-1)) as unknown as TFunction;
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
    icon('cam', 'camera', { color: '#9DB8F2', lens: 32, support: 'dolly', steps: [{ x: 1, y: 1 }] }),
    icon('anna', 'actor', { color: '#B897F0', pose: 'seated' }),
  ],
};

it('lists items by layer, modifiers with their light, filtered by layer and colour', () => {
  const all = elementSections(plan, { layer: 'all', color: null });
  expect(all.map((s) => [s.layer, s.items.length])).toEqual([
    ['lights', 1],
    ['camera', 1],
    ['actors', 1],
    ['set', 0],
    ['notes', 0],
  ]);
  expect(elementSections(plan, { layer: 'camera', color: null })).toHaveLength(1);
  const yellow = elementSections(plan, { layer: 'all', color: '#EDD963' });
  expect(yellow.flatMap((s) => s.items).map((e) => e.item.id)).toEqual([key.id]);
});

it('sums up a light, a camera and a person in one line', () => {
  expect(itemSummary(key, plan.icons, t)).toBe('cob 300 W · softbox · cstand');
  expect(itemSummary(plan.icons[2] as PlanIcon, plan.icons, t)).toBe('32 mm · dolly · 2 positions');
  expect(itemSummary(plan.icons[3] as PlanIcon, plan.icons, t)).toBe('seated');
  expect(selectionMix(plan.icons, t)).toBe('2 lights, 1 camera, 1 actors');
});
