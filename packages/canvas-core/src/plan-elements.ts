// SPDX-License-Identifier: MPL-2.0
import type { PlanIcon, PlanLayer } from '@inkadra/doc-schema';
import {
  iconSize,
  layerOf,
  PLAN_GRIP,
  type PlanElement,
  type PlanGroupName,
  type PlanItem,
  type PlanItemRef,
  planGroupOf,
  planItems,
} from './plan.ts';
import { modifiersOn } from './plan-attach.ts';
import { attachRole, catalogueKind, categoryOf, isLight } from './plan-icons.ts';
import { wattsText } from './plan-labels.ts';
import { iconWatts } from './plan-power.ts';
import type { Words } from './plan-words.ts';

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
  /**
   * A stand or a support under what it carries: listed with it, indented, so a base that what it
   * carries covers on the plan can still be picked, locked and deleted from the list.
   */
  sub?: boolean;
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
 * (decision 0117): modifiers with their light, the stands and supports that carry something
 * with what they carry ("Dolly on 4 m track"), identical icons folded into one row, filtered by
 * group and tag colour.
 */
export function elementSections(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  filter: ElementsFilter,
): Array<{ group: PlanGroupName; items: ElementRow[] }> {
  const icons = plan.icons ?? [];
  const byId = new Map(icons.map((i) => [i.id, i]));
  // A stand or a support with something on it is listed under what it carries.
  const carriers = new Set<string>();
  const carrierOf = new Map<string, PlanIcon>();
  for (const icon of icons) {
    const base = icon.on ? byId.get(icon.on) : undefined;
    if (
      base &&
      attachRole(icon.kind) !== 'modifier' &&
      ['camera', PLAN_GRIP].includes(planGroupOf(base))
    ) {
      carriers.add(base.id);
      carrierOf.set(icon.id, base);
    }
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
  /** The row and, under it, the bases its items stand on (a dolly, then its track). */
  const withBases = ({ ref, item, refs }: ElementRow): ElementRow[] => {
    const out: ElementRow[] = [{ ref, item, refs }];
    const seen = new Set<string>();
    let level = refs.flatMap((r) => carrierOf.get(r.id) ?? []);
    while (level.length) {
      const fresh = level.filter((b) => !seen.has(b.id));
      for (const b of fresh) seen.add(b.id);
      const sub: Array<ElementRow & { key: string }> = [];
      for (const b of fresh) {
        const r = { kind: 'icons' as const, id: b.id };
        const key = foldKey(b, icons);
        const same = sub.find((x) => x.key === key);
        if (same) same.refs.push(r);
        else sub.push({ key, ref: r, item: b, refs: [r], sub: true });
      }
      out.push(...sub.map(({ key: _key, ...row }) => row));
      level = fresh.flatMap((b) => carrierOf.get(b.id) ?? []);
    }
    return out;
  };
  return ELEMENT_GROUPS.filter((g) => filter.group === 'all' || filter.group === g).map(
    (group) => ({
      group,
      items: rows.filter(({ item }) => planGroupOf(item) === group).flatMap(withBases),
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
  t: Words,
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
export function itemName(item: PlanItem, t: Words): string {
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
  t: Words,
  {
    lens = true,
    scale,
    locale,
  }: { lens?: boolean; scale?: number | undefined; locale: string },
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
      lens ? `${icon.lens ?? 35} mm` : '',
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

/**
 * The icons of a plan's legend, as the read-only view and the PDF sheet list them: cameras;
 * lights standing on their own (a modifier is part of its light); grip standing on its own
 * (flags, frames, stands: the sheet lists them, the view leaves them to the kit); the cast
 * (people who can sit). Hidden layers are left out.
 */
export function planLegend(plan: Pick<PlanElement, 'icons' | 'hiddenLayers'>): {
  icons: PlanIcon[];
  cameras: PlanIcon[];
  lights: PlanIcon[];
  grip: PlanIcon[];
  cast: PlanIcon[];
} {
  const icons = (plan.icons ?? []).filter((i) => !plan.hiddenLayers?.includes(layerOf(i)));
  return {
    icons,
    cameras: icons.filter((i) => catalogueKind(i.kind) === 'camera'),
    lights: icons.filter((i) => isLight(i.kind) && !i.on),
    grip: icons.filter((i) => !i.on && categoryOf(i.kind).id === 'grip'),
    cast: icons.filter(
      (i) => categoryOf(i.kind).id === 'people' && attachRole(i.kind) === 'seated',
    ),
  };
}

/**
 * A row of the read-only view's legend: "Key ×2 · 35 mm" and, under it, the summary (an actor's
 * way through the scene, the notes of its positions, else `itemSummary` without the lens) with
 * the colour temperature.
 */
export function legendRow(
  icon: PlanIcon,
  count: number,
  icons: readonly PlanIcon[],
  t: Words,
  { scale, locale }: { scale?: number | undefined; locale: string },
): { name: string; sub: string } {
  const name = (icon.label || t(`board.plan.icons.${icon.kind}`)) + (count > 1 ? ` ×${count}` : '');
  // An actor's way through the scene: the notes of its positions, in order.
  const route =
    categoryOf(icon.kind).id === 'people' && icon.steps?.length
      ? [...icon.steps.map((s) => s.note), icon.stepNote].filter(Boolean).join(' → ')
      : '';
  const lens = catalogueKind(icon.kind) === 'camera' ? `${icon.lens ?? 35} mm` : '';
  const kelvin = icon.kelvin ? `${icon.kelvin} K` : '';
  // The lens is in the name: the summary goes on with the support and the moves.
  const summary = route || itemSummary(icon, icons, t, { lens: !lens, scale, locale });
  return {
    name: [name, lens].filter(Boolean).join(' · '),
    sub: [summary, kelvin].filter(Boolean).join(' · '),
  };
}

/**
 * The PDF sheet's legend line of a camera, a light or a person: the item's summary, as in
 * Elements, its watts in the app's language (`locale`).
 */
export function legendLine(
  icon: PlanIcon,
  icons: readonly PlanIcon[],
  t: Words,
  locale: string,
): string {
  const name = icon.label || t(`board.plan.icons.${icon.kind}`);
  // A camera's lens is the row's value at the right: not in the line too.
  const summary = itemSummary(icon, icons, t, { lens: false, locale });
  return summary ? `${name} · ${summary}` : name;
}

/** The value at the right of a PDF legend line: a camera's lens, a light's temperature and level. */
export function legendValue(icon: PlanIcon): string {
  if (catalogueKind(icon.kind) === 'camera') return `${icon.lens ?? 35} mm`;
  if (!isLight(icon.kind)) return '';
  return [
    icon.kelvin ? `${icon.kelvin} K` : '',
    icon.intensity !== undefined ? `${Math.round(icon.intensity * 100)}%` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
