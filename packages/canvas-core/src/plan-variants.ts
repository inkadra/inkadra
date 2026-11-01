// SPDX-License-Identifier: MPL-2.0
import type { Element, PlanIcon, PlanShape, PlanStroke } from '@inkadra/doc-schema';
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

export function planBaseOf(base: Plan): PlanBase {
  return {
    strokes: (base.strokes ?? []).filter(onSetLayer),
    shapes: (base.shapes ?? []).filter(onSetLayer),
    icons: (base.icons ?? []).filter(onSetLayer),
    ...(base.scale ? { scale: base.scale, grid: base.grid, rulers: base.rulers } : {}),
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
