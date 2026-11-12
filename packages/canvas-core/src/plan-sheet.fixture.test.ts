// SPDX-License-Identifier: MPL-2.0
import { expect, it } from 'vitest';
import { listElements } from './board.ts';
import { bigPlanFixture, planSheetFixture } from './plan-sheet.fixture.ts';

it('builds the sheet fixture as valid cards: three setups, attachments and links', () => {
  const { doc, planIds } = planSheetFixture();
  const all = listElements(doc);
  const plans = planIds.map((id) => all.find((el) => el.id === id));
  expect(plans.map((p) => p?.type === 'plan' && (p.variant ?? p.title))).toEqual([
    'Bancone',
    'Controcampo',
    'Dettaglio',
  ]);
  const base = plans[0];
  if (base?.type !== 'plan') throw new Error('No base');
  expect(base.walls).toHaveLength(1);
  expect(base.openings?.map((o) => o.kind)).toEqual(['window', 'window', 'door']);
  expect(base.circuits).toHaveLength(2);
  // A cam on the dolly on the track; the key light on its stand with its softbox and grid.
  expect(base.icons?.filter((i) => i.on)).toHaveLength(6);
  expect(all.filter((el) => el.type === 'character' && el.guestHidden)).toHaveLength(1);
});

it('fills the big fixture to the icon limit, its setups copying cameras, lights and people', () => {
  const { doc, planIds } = bigPlanFixture();
  const all = listElements(doc);
  const counts = planIds.map((id) => {
    const p = all.find((el) => el.id === id);
    return p?.type === 'plan' ? (p.icons?.length ?? 0) : 0;
  });
  expect(counts[0]).toBe(300);
  expect(counts[1]).toBeGreaterThan(150);
  expect(counts[2]).toBe(counts[1]);
});
