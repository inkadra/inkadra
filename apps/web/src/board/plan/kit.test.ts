// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { expect, it } from 'vitest';
import { kitList } from './kit.ts';

const t = ((key: string) => key.split('.').at(-1)) as unknown as TFunction;
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
  expect(kitList(plan, t)).toEqual([
    { name: 'fresnel 1,2K', count: 1 },
    { name: 'cstand', count: 3 },
    { name: 'fresnel 650', count: 1 },
    { name: 'dolly', count: 1 },
  ]);
  expect(kitList({ ...plan, hiddenLayers: ['lights'] }, t)).toEqual([{ name: 'dolly', count: 1 }]);
  // With a scale, a track says how long it is.
  const track = icon('track', { w: 300, h: 40 });
  expect(kitList({ icons: [track], scale: 100 }, t, 'it')).toEqual([
    { name: 'track 3 m', count: 1 },
  ]);
});
