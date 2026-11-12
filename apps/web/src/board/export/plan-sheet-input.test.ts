// SPDX-License-Identifier: AGPL-3.0-only
import {
  frameLabels,
  listElements,
  type PlanElement,
  storyboardOf,
  type Words,
} from '@inkadra/canvas-core';
import { planSheetFixture } from '@inkadra/canvas-core/fixtures/plan-sheet';
import { Element, hiddenFromGuests, toGuestElement } from '@inkadra/doc-schema';
import { planSheetInput, planSheetInputOf, sheetInclude } from '@inkadra/print';
import { expect, it } from 'vitest';

const t: Words = (key, values) =>
  values ? `${key}(${Object.values(values).join(',')})` : key;

/**
 * The guest cards as the server sends them (`apps/server/src/share-links.ts`: `viewOf`, then
 * `guestElement` parsed with `Element`), rebuilt here: the server's code is AGPL and the print
 * package is MPL, so the package cannot hold a copy of it.
 */
function serverGuestCards(all: readonly Element[]) {
  const byId = new Map(all.map((el) => [el.id, el]));
  const visible = all.filter((el) => !hiddenFromGuests(el.id, (id) => byId.get(id)));
  const shown = new Set(visible.map((el) => el.id));
  const labels = frameLabels(storyboardOf(all));
  const cards = new Map<string, Element>();
  for (const el of visible) {
    const out = toGuestElement(el, el.type === 'frame' ? (labels.get(el.id) ?? el.label) : undefined);
    if (el.type === 'character' && el.relations)
      out.relations = el.relations.filter((relation) => shown.has(relation.characterId));
    if (el.type === 'plan') {
      const icons = out.icons as Array<Record<string, unknown>> | undefined;
      if (icons)
        out.icons = icons.map((icon) => {
          const kept = { ...icon };
          for (const key of ['characterId', 'frameId'])
            if (typeof kept[key] === 'string' && !shown.has(kept[key] as string)) delete kept[key];
          return kept;
        });
      if (typeof out.locationId === 'string' && !shown.has(out.locationId)) delete out.locationId;
    }
    const card = Element.parse(out);
    cards.set(card.id, card);
  }
  return { cards, labels };
}

it('gives a guest the same sheet from audienceCards as from the server’s guest cards', () => {
  const fixture = planSheetFixture();
  const all = listElements(fixture.doc);
  const base = all.find((el) => el.id === fixture.planIds[0]) as PlanElement;
  const request = {
    planIds: fixture.planIds,
    area: null,
    include: sheetInclude(base),
    t,
    locale: 'en',
  };

  const team = planSheetInput({
    ...request,
    elements: all,
    filter: { audience: 'team', hideGuestHidden: false },
  });
  const guest = planSheetInput({
    ...request,
    elements: all,
    filter: { audience: 'client', hideGuestHidden: true },
  });
  const server = planSheetInputOf({ ...request, ...serverGuestCards(all) });

  expect(guest.input.setups).toHaveLength(3);
  expect(guest.input).toEqual(server);
  // The team's sheet prints the character hidden from guests; neither guest sheet does.
  expect(JSON.stringify(team.input)).toContain(fixture.hiddenName);
  expect(JSON.stringify(guest.input)).not.toContain(fixture.hiddenName);
  expect(JSON.stringify(server)).not.toContain(fixture.hiddenName);
  expect([...guest.cards.values()].some((el) => JSON.stringify(el).includes(fixture.hiddenName))).toBe(
    false,
  );
});
