// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon, PlanLayer } from '@inkadra/doc-schema';
import { iconCentre, iconSize, itemFrame, layerOf, type PlanItem } from './plan.ts';
import { ELEMENT_LAYERS } from './plan-elements.ts';
import { catalogueKind, SEATS } from './plan-icons.ts';
import type { Words } from './plan-words.ts';

/**
 * The choices the Properties of a plan's items offer and what they read from a selection
 * (decision 0116), so every client edits an item the same.
 */

/** Lens presets of a camera, as on the mockup; Other takes any focal length. */
export const LENSES = [24, 35, 50, 85];
/** Colour temperature presets, and the slider's range. */
export const KELVINS = [3200, 4300, 5600];
export const KELVIN_RANGE = [2000, 10000] as const;
/** Gels most crews ask for; anything else is typed. */
export const GELS = [
  'CTO ¼',
  'CTO ½',
  'CTO full',
  'CTB ¼',
  'CTB ½',
  'CTB full',
  '216',
  '250',
  'Plus green',
  'Minus green',
];

/** A number typed on a measure as it is stored ("6,20" gives "6.2"); null if it is no length. */
export function measureValue(typed: string): string | null {
  const m = Number(typed.trim().replace(',', '.'));
  return Number.isFinite(m) && m > 0 && m < 100000 ? String(m) : null;
}

/** "2 lights, 1 camera": what a selection holds, by layer. */
export function selectionMix(items: readonly PlanItem[], t: Words): string {
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
