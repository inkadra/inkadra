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
import {
  type PlanSheetInput,
  planSheetInput,
  planSheetInputOf,
  planSheetPages,
  sheetInclude,
} from '@inkadra/print';
import { light } from '@inkadra/ui/tokens';
import { expect, it } from 'vitest';

const t: Words = (key, values) => (values ? `${key}(${Object.values(values).join(',')})` : key);

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
    const out = toGuestElement(
      el,
      el.type === 'frame' ? (labels.get(el.id) ?? el.label) : undefined,
    );
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
  // The one difference: the web's guest cards keep an icon's link to a card guests don't get
  // (an id, never a name; it resolves to nothing), where the server's leave it out.
  const dangling = (input: PlanSheetInput) =>
    input.setups.flatMap((s) =>
      (s.plan.icons ?? []).flatMap((icon) =>
        [icon.characterId, icon.frameId].filter((id): id is string => !!id && !guest.cards.has(id)),
      ),
    );
  expect(new Set(dangling(guest.input))).toEqual(
    new Set([all.find((el) => el.type === 'character' && el.name === fixture.hiddenName)?.id]),
  );
  expect(dangling(server)).toEqual([]);
  const linkedOnly = (input: PlanSheetInput): PlanSheetInput => ({
    ...input,
    setups: input.setups.map((s) => ({
      ...s,
      plan: {
        ...s.plan,
        icons: s.plan.icons?.map((icon) => {
          const kept = { ...icon };
          if (kept.characterId && !guest.cards.has(kept.characterId)) delete kept.characterId;
          if (kept.frameId && !guest.cards.has(kept.frameId)) delete kept.frameId;
          return kept;
        }),
      },
    })),
  });
  expect(linkedOnly(guest.input)).toEqual(server);
  // And the sheet prints the same, drawn against each one's own cards.
  const pages = (input: PlanSheetInput, cards: ReadonlyMap<string, Element>) =>
    planSheetPages(input, {
      measure: (value, size) => [...value].length * size * 0.5,
      colors: light,
      language: 'en',
      cards,
    });
  expect(pages(guest.input, guest.cards)).toEqual(pages(server, serverGuestCards(all).cards));
  // The team's sheet prints the character hidden from guests; neither guest sheet does.
  expect(JSON.stringify(team.input)).toContain(fixture.hiddenName);
  expect(JSON.stringify(guest.input)).not.toContain(fixture.hiddenName);
  expect(JSON.stringify(server)).not.toContain(fixture.hiddenName);
  expect(
    [...guest.cards.values()].some((el) => JSON.stringify(el).includes(fixture.hiddenName)),
  ).toBe(false);
});
