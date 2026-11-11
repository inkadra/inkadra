// SPDX-License-Identifier: AGPL-3.0-only
import {
  attachRole,
  catalogueKind,
  iconWatts,
  isLight,
  layerOf,
  modifiersOn,
  type PlanElement,
  type PlanItem,
  type PlanItemRef,
  planItems,
} from '@inkadra/canvas-core';
import type { PlanIcon, PlanLayer } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';

/** The sections of the Elements tab, in the mockup's order. */
export const ELEMENT_LAYERS: readonly PlanLayer[] = ['lights', 'camera', 'actors', 'set', 'notes'];

export interface ElementsFilter {
  layer: PlanLayer | 'all';
  /** Only items of this tag colour (a stored hex). */
  color: string | null;
}

/**
 * The items of a plan for the Elements tab, by layer: modifiers listed with their light (not on
 * their own), the rest each once, filtered by layer and tag colour.
 */
export function elementSections(
  plan: Pick<PlanElement, 'strokes' | 'shapes' | 'icons'>,
  filter: ElementsFilter,
): Array<{ layer: PlanLayer; items: Array<{ ref: PlanItemRef; item: PlanItem }> }> {
  const icons = plan.icons ?? [];
  const ids = new Set(icons.map((i) => i.id));
  const all = planItems(plan).filter(({ item }) => {
    if (filter.color && item.color !== filter.color) return false;
    // A modifier on a light is a line of its light.
    if ('x' in item && item.on && ids.has(item.on) && attachRole(item.kind) === 'modifier')
      return false;
    return true;
  });
  return ELEMENT_LAYERS.filter((l) => filter.layer === 'all' || filter.layer === l).map(
    (layer) => ({ layer, items: all.filter(({ item }) => layerOf(item) === layer) }),
  );
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
      [icon.label ? typeName : '', icon.power || (watts ? `${watts} W` : '')]
        .filter(Boolean)
        .join(' '),
      icon.make,
      modifiersOn(icon, icons)
        .map((m) => t(`board.plan.icons.${m.kind}`))
        .join(', '),
      icon.gel ? `${t('board.plan.icons.gel')} ${icon.gel}` : '',
      base ? t(`board.plan.icons.${base.kind}`) : icon.stand ? t(`board.plan.stands.${icon.stand}`) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (kind === 'camera')
    return [
      `${icon.lens ?? 35} mm`,
      base ? t(`board.plan.icons.${base.kind}`) : icon.support ? t(`board.plan.supports.${icon.support}`) : '',
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
