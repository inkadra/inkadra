// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, PlanIcon } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { expect, it } from 'vitest';
import { setupChanges, shotSetups } from './setups.ts';

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
    { planId: 'baseAAAAAAAAA', name: '1 · board.plan.base', plan: 'board.plan.name · Diner' },
    { planId: 'closeAAAAAAAA', name: '2 · CU Anna', plan: 'board.plan.name · Diner' },
  ]);
});
