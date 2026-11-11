// SPDX-License-Identifier: AGPL-3.0-only
import {
  attachRole,
  catalogueKind,
  iconCentre,
  iconSize,
  iconWatts,
  isLight,
  itemFrame,
  layerOf,
  modifiersOn,
  PLAN_GRIP,
  type PlanElement,
  type PlanGroupName,
  type PlanItem,
  type PlanItemRef,
  planGroupOf,
  planItems,
  SEATS,
} from '@inkadra/canvas-core';
import type { PlanIcon, PlanLayer } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import { wattsText } from './kit.ts';

/** The layers, in the mockup's order. */
export const ELEMENT_LAYERS: readonly PlanLayer[] = ['lights', 'camera', 'actors', 'set', 'notes'];
/** The sections of the Elements tab, in the mockup's order (decision 0114). */
export const ELEMENT_GROUPS: readonly PlanGroupName[] = [
  'lights',
  'camera',
  'actors',
  PLAN_GRIP,
  'set',
  'notes',
];

export interface ElementsFilter {
  group: PlanGroupName | 'all';
  /** Only items of this tag colour (a stored hex). */
  color: string | null;
}

/** A row of the Elements tab: an item, or identical ones folded ("Practicals ×3"). */
export interface ElementRow {
  ref: PlanItemRef;
  item: PlanItem;
  /** Every item of the row, the first one included; a click selects them all. */
  refs: PlanItemRef[];
}

/** What makes two icons the same row: type, name, power, what they stand on, tag and links. */
function foldKey(icon: PlanIcon, icons: readonly PlanIcon[]): string {
  const base = icon.on ? icons.find((i) => i.id === icon.on) : undefined;
  return [
    icon.kind,
    icon.label ?? '',
    icon.watts ?? '',
    icon.power ?? '',
    base ? catalogueKind(base.kind) : '',
    icon.color,
    icon.layer ?? '',
    icon.characterId ?? '',
    icon.frameId ?? '',
    icon.steps?.length ?? 0,
    icon.locked ? 1 : 0,
  ].join('\u0000');
}

/** Identical icons as one entry with how many ("Table lamp ×3"), in the order they come. */
export function foldIcons(
  list: readonly PlanIcon[],
  icons: readonly PlanIcon[],
): Array<{ icon: PlanIcon; count: number }> {
  const out = new Map<string, { icon: PlanIcon; count: number }>();
  for (const icon of list) {
    const key = foldKey(icon, icons);
    const known = out.get(key);
    if (known) known.count += 1;
    else out.set(key, { icon, count: 1 });
  }
  return [...out.values()];
}

/**
 * The items of a plan for the Elements tab, by group (planGroupOf), as the mockup lists them
 * (decision 0116): modifiers with their light, the stands and supports that carry something
 * with what they carry ("Dolly on 4 m track"), identical icons folded into one row, filtered by
 * group and tag colour.
 */
export function elementSections(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  filter: ElementsFilter,
): Array<{ group: PlanGroupName; items: ElementRow[] }> {
  const icons = plan.icons ?? [];
  const byId = new Map(icons.map((i) => [i.id, i]));
  // A stand or a support with something on it is a line of what it carries.
  const carriers = new Set<string>();
  for (const icon of icons) {
    const base = icon.on ? byId.get(icon.on) : undefined;
    if (
      base &&
      attachRole(icon.kind) !== 'modifier' &&
      ['camera', PLAN_GRIP].includes(planGroupOf(base))
    )
      carriers.add(base.id);
  }
  const all = planItems(plan).filter(({ item }) => {
    if (filter.color && item.color !== filter.color) return false;
    if (!('x' in item)) return true;
    // A modifier on a light is a line of its light.
    if (item.on && byId.has(item.on) && attachRole(item.kind) === 'modifier') return false;
    return !carriers.has(item.id);
  });
  const rows: Array<ElementRow & { key: string }> = [];
  for (const { ref, item } of all) {
    const key = 'x' in item ? foldKey(item, icons) : item.id;
    const same = rows.find((r) => r.key === key);
    if (same) same.refs.push(ref);
    else rows.push({ key, ref, item, refs: [ref] });
  }
  return ELEMENT_GROUPS.filter((g) => filter.group === 'all' || filter.group === g).map(
    (group) => ({
      group,
      items: rows
        .filter(({ item }) => planGroupOf(item) === group)
        .map(({ ref, item, refs }) => ({ ref, item, refs })),
    }),
  );
}

/**
 * What an item stands on, as the panels say it: "Dolly on 4 m track" for a dolly on a track
 * (its length with a scale), else the base's name or type.
 */
export function supportText(
  base: PlanIcon,
  icons: readonly PlanIcon[],
  t: TFunction,
  scale?: number,
  locale?: string,
): string {
  const under = base.on ? icons.find((i) => i.id === base.on) : undefined;
  const name = base.label || t(`board.plan.icons.${base.kind}`);
  if (!under || catalogueKind(under.kind) !== 'track') return name;
  const { w, h } = iconSize(under);
  const long = Math.max(w, h);
  return scale && long
    ? t('board.plan.onTrackLength', {
        name,
        metres: (long / scale).toLocaleString(locale, { maximumFractionDigits: 1 }),
      })
    : t('board.plan.onTrack', { name });
}

/** The name of an item in the lists: its label, else its kind's name, else its text. */
export function itemName(item: PlanItem, t: TFunction): string {
  if ('x' in item) return item.label || t(`board.plan.icons.${item.kind}`);
  if ('x0' in item) return item.text || t(`board.plan.shapes.${item.kind}`);
  return t('board.plan.tool.pencil');
}

/**
 * The line under an item: "LED COB 300 W · Softbox, grid · C-stand" for a light, "32 mm · Dolly ·
 * 2 positions" for a camera, "Seated, Stool · 2 positions" for a person; the type for the rest.
 */
export function itemSummary(
  icon: PlanIcon,
  icons: readonly PlanIcon[],
  t: TFunction,
  { scale, locale }: { scale?: number | undefined; locale?: string | undefined } = {},
): string {
  const kind = catalogueKind(icon.kind);
  const typeName = t(`board.plan.icons.${icon.kind}`);
  const base = icon.on ? icons.find((i) => i.id === icon.on) : undefined;
  const positions = icon.steps?.length
    ? t('board.plan.positions', { count: icon.steps.length + 1 })
    : '';
  if (isLight(kind)) {
    const watts = iconWatts(icon);
    return [
      [icon.label ? typeName : '', icon.power || (watts ? wattsText(watts, locale) : '')]
        .filter(Boolean)
        .join(' '),
      icon.make,
      modifiersOn(icon, icons)
        .map((m) => t(`board.plan.icons.${m.kind}`))
        .join(', '),
      icon.gel ? `${t('board.plan.icons.gel')} ${icon.gel}` : '',
      base
        ? t(`board.plan.icons.${base.kind}`)
        : icon.stand
          ? t(`board.plan.stands.${icon.stand}`)
          : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (kind === 'camera')
    return [
      `${icon.lens ?? 35} mm`,
      base
        ? supportText(base, icons, t, scale, locale)
        : icon.support
          ? t(`board.plan.supports.${icon.support}`)
          : '',
      positions,
    ]
      .filter(Boolean)
      .join(' · ');
  if (attachRole(kind) === 'seated')
    return [
      icon.pose && icon.pose !== 'standing' ? t(`board.plan.poses.${icon.pose}`) : '',
      base ? t(`board.plan.icons.${base.kind}`) : '',
      positions,
      icon.note,
    ]
      .filter(Boolean)
      .join(' · ');
  return [icon.label ? typeName : '', base ? t(`board.plan.icons.${base.kind}`) : '', icon.note]
    .filter(Boolean)
    .join(' · ');
}

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
 * The seats at a table or a counter ("4 stools", decision 0116): the seats attached to it, or
 * standing against it, in its turned frame.
 */
export function seatsAround(prop: PlanIcon, icons: readonly PlanIcon[]): number {
  const frame = itemFrame(prop);
  if (!frame) return 0;
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
  }).length;
}
