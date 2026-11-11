// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { expect, it } from 'vitest';
import { dayBySetup, groupBySetup, type ShotSetup, setupChanges, shotSetups } from './setups.ts';

const icon = (id: string, kind: PlanIcon['kind'], extra: Partial<PlanIcon> = {}): PlanIcon => ({
  id: id.padEnd(13, 'A'),
  kind,
  color: '#9DB8F2',
  x: 1000,
  y: 1000,
  ...extra,
});

it('tells what a setup moved, changed, added and left out of the base', () => {
  const base = [
    icon('a', 'camera', { label: 'A cam' }),
    icon('b', 'camera', { label: 'B cam', x: 2000 }),
    icon('k', 'cob', { label: 'Key', watts: 300 }),
    icon('t', 'table'),
  ];
  const setup = [
    icon('b2', 'camera', { label: 'B cam', x: 2600, lens: 85 }),
    icon('k2', 'cob', { label: 'Key', watts: 600 }),
    icon('n', 'flag'),
  ];
  const changes = setupChanges(base, setup);
  expect(changes.map((c) => [c.kind, c.icon.label ?? c.icon.kind])).toEqual([
    ['moved', 'B cam'],
    ['changed', 'Key'],
    ['added', 'flag'],
    ['removed', 'A cam'],
  ]);
  expect(changes[0]).toMatchObject({ lens: 85 });
  // The Set (the table) is shared, never a change; a copy left alone says nothing.
  expect(
    setupChanges(
      base,
      base.map((i) => ({ ...i, id: `${i.id.slice(0, 12)}B` })),
    ),
  ).toEqual([]);
});

it('lists the setups each shot belongs to, by the frames its cameras link to', () => {
  const card = { x: 0, y: 0, w: 100, z: 'a0', parent: null, createdBy: null };
  const plan = (id: string, createdAt: number, extra: Record<string, unknown>) =>
    ({ ...card, id: id.padEnd(13, 'A'), type: 'plan', createdAt, ...extra }) as Element;
  const frame = { ...card, createdAt: 1, id: 'frameAAAAAAAA', type: 'frame' } as Element;
  const cam = icon('c', 'camera', { frameId: 'frameAAAAAAAA' });
  const elements = [
    frame,
    plan('base', 1, { title: 'Diner', icons: [cam] }),
    plan('close', 2, { variantOf: 'baseAAAAAAAAA', variant: 'CU Anna', icons: [cam] }),
    plan('empty', 3, { variantOf: 'baseAAAAAAAAA', icons: [] }),
  ];
  const t = ((key: string) => key) as unknown as TFunction;
  expect(shotSetups(elements, t).get('frameAAAAAAAA')).toEqual([
    {
      planId: 'baseAAAAAAAAA',
      name: '1 · board.plan.base',
      plan: 'board.plan.name · Diner',
      order: 0,
    },
    {
      planId: 'closeAAAAAAAA',
      name: '2 · CU Anna',
      plan: 'board.plan.name · Diner',
      order: 1,
    },
  ]);
});

it('groups shots under their setups in the order of the plans, shots in none last', () => {
  const setup = (planId: string, order: number): ShotSetup => ({
    planId,
    name: planId,
    plan: 'Plan',
    order,
  });
  const a = setup('a', 0);
  const b = setup('b', 1);
  const setups = new Map([
    ['s1', [b]],
    ['s2', [a, b]],
  ]);
  const groups = groupBySetup([{ id: 'loose' }, { id: 's1' }, { id: 's2' }], setups);
  expect(groups.map((g) => [g.setup?.planId ?? null, g.shots.map((s) => s.id)])).toEqual([
    ['a', ['s2']],
    ['b', ['s1', 's2']],
    [null, ['loose']],
  ]);
  // No plans: no setup group, all shots under the plain heading.
  expect(groupBySetup([{ id: 's1' }], new Map())).toEqual([{ setup: null, shots: [{ id: 's1' }] }]);
});

it("puts a day's shot blocks under their setups, leaving out omitted scenes and other blocks", () => {
  const card = { x: 0, y: 0, w: 100, z: 'a0', createdBy: null, createdAt: 1 };
  const byId = new Map<string, Element>([
    ['s1', { ...card, id: 's1', type: 'scene', parent: null, number: '1' } as Element],
    [
      's2',
      { ...card, id: 's2', type: 'scene', parent: null, number: '2', omitted: true } as Element,
    ],
    ['f1', { ...card, id: 'f1', type: 'frame', parent: 's1' } as Element],
    ['f2', { ...card, id: 'f2', type: 'frame', parent: 's2' } as Element],
  ]);
  const setup: ShotSetup = { planId: 'p', name: '1', plan: 'Plan', order: 0 };
  const blocks = [{ shotId: 'f2' }, { shotId: null }, { shotId: 'gone' }, { shotId: 'f1' }];
  expect(dayBySetup(blocks, byId, new Map([['f1', [setup]]]))).toEqual([
    { setup, shots: [{ id: 'f1', block: { shotId: 'f1' } }] },
  ]);
  expect(dayBySetup([{ shotId: 'f2' }], byId, new Map())).toEqual([]);
});
