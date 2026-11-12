// SPDX-License-Identifier: MPL-2.0
import {
  CHARACTER_COLOURS,
  frameLabels,
  linkedLocation,
  linkedPlan,
  type PlanElement,
  type ScheduledDay,
  sceneDay,
  setupFrames,
  setupName,
  storyboardOf,
  variantFamily,
  variantView,
  type Words,
} from '@inkadra/canvas-core';
import { Element, hiddenFromGuests, toGuestElement } from '@inkadra/doc-schema';
import type { PlanSheetInclude, PlanSheetInput } from './plan-sheet.ts';

/**
 * Who an export is for. `client` keeps exactly what a guest of a share link sees: hidden
 * cards and their contents are left out and each element keeps only its guest fields.
 */
export type Audience = 'team' | 'client';

export interface ExportFilter {
  audience: Audience;
  /** Leave out cards hidden from guests even for the team. Always true for clients. */
  hideGuestHidden: boolean;
}

type Lookup = (id: string) => Element | undefined;

/** The element as the export may show it, or null when it must be left out. */
export function exportable(el: Element, lookup: Lookup, filter: ExportFilter): Element | null {
  const client = filter.audience === 'client';
  if ((client || filter.hideGuestHidden) && hiddenFromGuests(el.id, lookup)) return null;
  if (!client) return el;
  const parsed = Element.safeParse(toGuestElement(el));
  return parsed.success ? parsed.data : null;
}

/**
 * The cards an export's audience may see, by id, for the links of set plans (decision 0111): a
 * plan linked to a card hidden from guests resolves nothing from it in an export for them.
 */
export function audienceCards(
  all: Iterable<Element>,
  lookup: Lookup,
  filter: ExportFilter,
): Map<string, Element> {
  const out = new Map<string, Element>();
  for (const el of all) {
    const shown = exportable(el, lookup, filter);
    if (shown) out.set(shown.id, shown);
  }
  return out;
}

/** "INT. ROSA'S DINER – NIGHT": the scene's setting, place and time. */
export function slugline(scene: Extract<Element, { type: 'scene' }>, t: Words): string {
  return [
    scene.setting && t(`film.scene.settings.${scene.setting}`),
    scene.location?.toUpperCase(),
    scene.time && `– ${t(`film.scene.times.${scene.time}`)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** What the export dialog or the plan's view asks of the sheet (decision 0111). */
export interface PlanSheetRequest {
  /** The setups to print, one page each, in this order. */
  planIds: readonly string[];
  area: PlanSheetInput['area'];
  include: PlanSheetInclude;
  t: Words;
  locale: string;
  /**
   * The board's shooting days, for the "Day N" of the plan's scene at the foot (`sceneDay`); none
   * where the schedule cannot be read. A guest's sheet prints no day (decision 0111): the
   * schedule is the team's, and `planSheetInput` leaves the days out for clients.
   */
  days: readonly ScheduledDay[];
}

/**
 * The input of the sheet from the cards its audience may see and the shot labels of the whole
 * board (computed before anything is left out, as guests see them). Everything is read from
 * `cards` (decisions 0013, 0044, 0111): a plan, a base, a scene, a character, a frame or a
 * location left out of them is not read. A sheet for `client` (a guest's) prints no day, whatever
 * `days` holds: the schedule is the team's (decision 0122).
 */
export function planSheetInputOf(
  request: PlanSheetRequest & {
    cards: ReadonlyMap<string, Element>;
    labels: ReadonlyMap<string, string>;
    /** Who the sheet is for; left out, the team. */
    audience?: Audience;
  },
): PlanSheetInput {
  const { cards, labels, t } = request;
  const days = request.audience === 'client' ? [] : request.days;
  const see = (id: string) => cards.get(id);
  const plans = request.planIds.flatMap((id) => {
    const el = see(id);
    return el?.type === 'plan' ? [el] : [];
  });
  const first = plans[0];
  const baseOf = (p: PlanElement) => {
    const base = p.variantOf ? see(p.variantOf) : undefined;
    return base?.type === 'plan' ? base : undefined;
  };
  const owner = first ? (baseOf(first) ?? first) : undefined;
  const sceneIds = first?.sceneIds ?? owner?.sceneIds ?? [];
  const scene = sceneIds.map(see).find((el) => el?.type === 'scene');
  const location = owner ? linkedLocation(owner, cards) : null;
  const day =
    scene?.type === 'scene' && request.include.dateScene ? sceneDay(days, scene.id, cards) : null;
  return {
    setups: plans.map((p) => {
      const base = baseOf(p);
      return {
        plan: linkedPlan(base ? variantView(p, base) : p, cards, {
          palette: CHARACTER_COLOURS,
        }),
        name: `${t('board.plan.sheet.setup')} ${setupName(p, variantFamily(cards.values(), p), t)}`,
        // The storyboard's number of each shot, else the frame's own label; none, left out.
        shots: setupFrames(p, cards).flatMap((id) => {
          const frame = cards.get(id);
          const label = labels.get(id) || (frame?.type === 'frame' ? frame.label : '');
          return label ? [label] : [];
        }),
      };
    }),
    scene:
      scene?.type === 'scene'
        ? [t('board.plan.links.scene', { number: scene.number }), slugline(scene, t)]
            .filter(Boolean)
            .join(' · ')
        : '',
    // "Rosa's diner · Day 3".
    place: [
      location?.name ?? (scene?.type === 'scene' ? scene.location : '') ?? '',
      day ? t('board.plan.sheet.day', { n: day }) : '',
    ]
      .filter(Boolean)
      .join(' · '),
    area: request.area,
    include: request.include,
    t,
    locale: request.locale,
  };
}

/**
 * The input of the sheet from all the board's elements, for its audience: the cards it may see
 * (`audienceCards`) and the shot labels of the whole board. `cards` is what the drawing's links
 * resolve against too (`PlanDrawContext.cards`).
 */
export function planSheetInput(
  request: PlanSheetRequest & { elements: readonly Element[]; filter: ExportFilter },
): { input: PlanSheetInput; cards: Map<string, Element> } {
  const byId = new Map(request.elements.map((el) => [el.id, el]));
  const cards = audienceCards(request.elements, (id) => byId.get(id), request.filter);
  const labels = frameLabels(storyboardOf(request.elements));
  // Guests cannot read the schedule (decision 0111): no day on their sheet, whatever is given.
  return {
    input: planSheetInputOf({ ...request, audience: request.filter.audience, cards, labels }),
    cards,
  };
}
