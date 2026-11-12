// SPDX-License-Identifier: AGPL-3.0-only
import {
  catalogueKind,
  ELEMENT_LAYERS,
  iconCentre,
  iconSize,
  itemFrame,
  layerOf,
  type PlanItem,
  SEATS,
} from '@inkadra/canvas-core';
import type { PlanIcon, PlanLayer } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';

/**
 * The rows of the Elements tab, the names and summaries of items and the legend live in
 * canvas-core (decision 0116): every client lists a plan the same.
 */
export {
  ELEMENT_GROUPS,
  ELEMENT_LAYERS,
  type ElementRow,
  type ElementsFilter,
  elementSections,
  foldIcons,
  itemName,
  itemSummary,
  supportText,
} from '@inkadra/canvas-core';

/** "2 lights, 1 camera": what a selection holds, by layer. */
export function selectionMix(items: readonly PlanItem[], t: TFunction): string {
  const counts = new Map<PlanLayer, number>();
  for (const item of items) counts.set(layerOf(item), (counts.get(layerOf(item)) ?? 0) + 1);
  return ELEMENT_LAYERS.filter((l) => counts.has(l))
    .map((l) => t(`board.plan.mix.${l}`, { count: counts.get(l) }))
    .join(', ');
}

/** What people sit at: the props whose Properties count the seats around them. */
export const SEAT_SURFACES: ReadonlySet<string> = new Set([
  'table',
  'roundtable',
  'desk',
  'counter',
]);

/**
 * The seats at a table or a counter ("4 stools", decision 0117): the seats attached to it, or
 * standing against it, in its turned frame.
 */
export function seatsAround(prop: PlanIcon, icons: readonly PlanIcon[]): number {
  return seatsAt(prop, icons).length;
}

/** Seat kinds the Properties name in the plural ("4 stools"); other seats count as "seats". */
export const NAMED_SEATS = ['stool', 'chair', 'armchair', 'dirchair', 'sofa', 'bench'] as const;

/**
 * How the Properties of a table or counter write its seats: "4 stools" when they are all of one
 * named kind (`kind`), else "4 seats" (`kind` null).
 */
export function seatsLine(
  prop: PlanIcon,
  icons: readonly PlanIcon[],
): { count: number; kind: (typeof NAMED_SEATS)[number] | null } {
  const seats = seatsAt(prop, icons);
  const kinds = new Set(seats.map((i) => catalogueKind(i.kind)));
  const [only] = [...kinds];
  const named = kinds.size === 1 && (NAMED_SEATS as readonly string[]).includes(only as string);
  return {
    count: seats.length,
    kind: named ? (only as (typeof NAMED_SEATS)[number]) : null,
  };
}

/** The seats at a table or a counter: attached to it, or standing against it. */
function seatsAt(prop: PlanIcon, icons: readonly PlanIcon[]): PlanIcon[] {
  const frame = itemFrame(prop);
  if (!frame) return [];
  const a = (-frame.angle * Math.PI) / 180;
  return icons.filter((i) => {
    if (i.id === prop.id || SEATS[catalogueKind(i.kind)] === undefined) return false;
    if (i.on === prop.id) return true;
    const c = iconCentre(i);
    const size = iconSize(i);
    const dx = c.x - frame.centre.x;
    const dy = c.y - frame.centre.y;
    // The seat's centre in the prop's own axes, against its edges plus half the seat.
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const reach = Math.max(size.w, size.h) / 2;
    return Math.abs(lx) <= frame.w / 2 + reach && Math.abs(ly) <= frame.h / 2 + reach;
  });
}
