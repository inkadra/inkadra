// SPDX-License-Identifier: MPL-2.0
import {
  type Element,
  MAX_PLAN_ICONS,
  MAX_SHAPES,
  MAX_STROKES,
  type PlanIcon,
  type PlanShape,
  type PlanStroke,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { categoryOf } from './plan-icons.ts';

/**
 * Keeping a variant whole when its base is gone (decision 0062): the Set layer the variant
 * showed from its base is copied into it and the link dropped. Kept apart from plan.ts so the
 * board's delete and paste can use it without an import cycle.
 */

type Item = PlanStroke | PlanShape | PlanIcon;
type Plan = Extract<Element, { type: 'plan' }>;

/** True for an item on the Set layer (its own layer, or its family's default). */
export function onSetLayer(item: Item): boolean {
  if (item.layer) return item.layer === 'set';
  if ('kind' in item && 'x' in item) return categoryOf(item.kind).layer === 'set';
  return !('kind' in item && (item.kind === 'measure' || item.kind === 'text'));
}

/** What a variant needs of its base to stand alone: its Set and its scale. */
export interface PlanBase {
  strokes: PlanStroke[];
  shapes: PlanShape[];
  icons: PlanIcon[];
  scale?: number | undefined;
  grid?: Plan['grid'];
  rulers?: boolean | undefined;
}

const LIMITS = { strokes: MAX_STROKES, shapes: MAX_SHAPES, icons: MAX_PLAN_ICONS };

/**
 * The Set of a base plan as stored, so fields and items this build does not know go along
 * (decision 0101). Icons come out as plain objects; adoptBase stores them as Y.Maps again.
 */
export function planBaseOf(base: Y.Map<unknown>): PlanBase {
  const set = (key: 'strokes' | 'shapes' | 'icons') => {
    const list = base.get(key);
    const items = list instanceof Y.Array ? list.toArray() : Array.isArray(list) ? list : [];
    // Within the plan's limits, as reads cut them: two people drawing at once can pass them.
    return items
      .slice(0, LIMITS[key])
      .map((item) => (item instanceof Y.Map ? item.toJSON() : item))
      .filter((item) => typeof item === 'object' && item !== null && onSetLayer(item));
  };
  const scale = base.get('scale');
  return {
    strokes: set('strokes'),
    shapes: set('shapes'),
    icons: set('icons'),
    ...(typeof scale === 'number' && scale
      ? { scale, grid: base.get('grid') as Plan['grid'], rulers: base.get('rulers') as boolean }
      : {}),
  };
}

/** Writes `base` into the Y.Map of a variant, first in each list, and drops the link. */
export function adoptBase(variant: Y.Map<unknown>, base: PlanBase): void {
  for (const kind of ['strokes', 'shapes', 'icons'] as const) {
    const items = base[kind] as Item[];
    if (items.length === 0) continue;
    let list = variant.get(kind);
    if (!(list instanceof Y.Array)) {
      list = new Y.Array<unknown>();
      variant.set(kind, list);
    }
    (list as Y.Array<unknown>).insert(
      0,
      kind === 'icons' ? items.map((i) => new Y.Map<unknown>(Object.entries(i))) : items,
    );
  }
  for (const key of ['scale', 'grid', 'rulers'] as const)
    if (base[key] !== undefined && variant.get(key) === undefined) variant.set(key, base[key]);
  variant.delete('variantOf');
}
