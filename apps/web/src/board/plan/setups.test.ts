// SPDX-License-Identifier: AGPL-3.0-only
import type { PlanIcon } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { setupChanges } from './setups.ts';

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
