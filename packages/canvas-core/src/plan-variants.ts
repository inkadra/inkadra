// SPDX-License-Identifier: MPL-2.0
import {
  type Element,
  MAX_PLAN_CIRCUITS,
  MAX_PLAN_ICONS,
  MAX_PLAN_OPENINGS,
  MAX_PLAN_WALLS,
  MAX_SHAPES,
  MAX_STROKES,
  type PlanCircuit,
  type PlanIcon,
  type PlanOpening,
  type PlanShape,
  type PlanStroke,
  type PlanWall,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { kindLayer } from './plan-icons.ts';

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
  if ('kind' in item && 'x' in item) return kindLayer(item.kind) === 'set';
  return !('kind' in item && (item.kind === 'measure' || item.kind === 'text'));
}

/**
 * What a variant needs of its base to stand alone: its Set (walls too) and its scale, and what a
 * setup reads from its base while it has one (decision 0117): the circuits and mains voltage,
 * the background picture, the location, north, the scenes and the title.
 */
export interface PlanBase {
  strokes: PlanStroke[];
  shapes: PlanShape[];
  icons: PlanIcon[];
  walls?: PlanWall[];
  openings?: PlanOpening[];
  scale?: number | undefined;
  grid?: Plan['grid'];
  rulers?: boolean | undefined;
  roomSizes?: boolean | undefined;
  circuits?: PlanCircuit[];
  voltage?: Plan['voltage'];
  background?: Plan['background'];
  locationId?: string;
  north?: number;
  sceneIds?: string[];
  title?: string;
}

/** The fields of a plan a setup takes from its base when it stands alone (decision 0117). */
const OWNED = ['voltage', 'background', 'locationId', 'north', 'sceneIds'] as const;

/**
 * What a setup becomes on its own (decision 0117), from its own fields and its base's: the base's
 * circuits first, with their ids so its lights stay on them, then any it held itself, within the
 * limit; the base's voltage, background, location, north and scenes where it has none; and the
 * base's title, since a setup never owns one (none if the base had none).
 */
export function standAlone(
  own: { circuits?: readonly { id?: unknown }[] | undefined } & Partial<
    Record<(typeof OWNED)[number], unknown>
  >,
  base: PlanBase,
): {
  /** Circuits of the base to put first, in order. */
  circuits: PlanCircuit[];
  /** Fields to write; `title: undefined` deletes a stale copy. */
  fields: Partial<Pick<PlanBase, (typeof OWNED)[number] | 'title'>> & { title: string | undefined };
} {
  const held = new Set((own.circuits ?? []).map((c) => c.id));
  const room = Math.max(0, MAX_PLAN_CIRCUITS - (own.circuits?.length ?? 0));
  const circuits = (base.circuits ?? []).filter((c) => !held.has(c.id)).slice(0, room);
  const fields: Record<string, unknown> = { title: base.title };
  for (const key of OWNED)
    if (own[key] === undefined && base[key] !== undefined) fields[key] = base[key];
  return { circuits, fields: fields as ReturnType<typeof standAlone>['fields'] };
}

const LIMITS = {
  strokes: MAX_STROKES,
  shapes: MAX_SHAPES,
  icons: MAX_PLAN_ICONS,
  walls: MAX_PLAN_WALLS,
  openings: MAX_PLAN_OPENINGS,
};

/**
 * The Set of a base plan as stored, so fields and items this build does not know go along
 * (decision 0101). Icons come out as plain objects; adoptBase stores them as Y.Maps again.
 */
export function planBaseOf(base: Y.Map<unknown>): PlanBase {
  const set = (key: 'strokes' | 'shapes' | 'icons' | 'walls' | 'openings') => {
    const list = base.get(key);
    const items = list instanceof Y.Array ? list.toArray() : Array.isArray(list) ? list : [];
    // Within the plan's limits, as reads cut them: two people drawing at once can pass them.
    return items
      .slice(0, LIMITS[key])
      .map((item) => (item instanceof Y.Map ? item.toJSON() : item))
      .filter(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          (key === 'walls' || key === 'openings' || onSetLayer(item)),
      );
  };
  const scale = base.get('scale');
  const circuits = base.get('circuits');
  const circuitList = (
    circuits instanceof Y.Array ? circuits.toArray() : Array.isArray(circuits) ? circuits : []
  )
    .slice(0, MAX_PLAN_CIRCUITS)
    .map((c) => (c instanceof Y.Map ? c.toJSON() : c))
    .filter((c): c is PlanCircuit => typeof c === 'object' && c !== null && 'id' in c);
  const owned: Partial<PlanBase> = {};
  for (const key of [...OWNED, 'title'] as const) {
    const value = base.get(key);
    if (value !== undefined) (owned as Record<string, unknown>)[key] = value;
  }
  return {
    ...owned,
    ...(circuitList.length ? { circuits: circuitList } : {}),
    strokes: set('strokes'),
    shapes: set('shapes'),
    icons: set('icons'),
    walls: set('walls'),
    openings: set('openings'),
    ...(typeof scale === 'number' && scale
      ? { scale, grid: base.get('grid') as Plan['grid'], rulers: base.get('rulers') as boolean }
      : {}),
    ...(base.get('roomSizes') === false ? { roomSizes: false } : {}),
  };
}

/** Writes `base` into the Y.Map of a variant, first in each list, and drops the link. */
export function adoptBase(variant: Y.Map<unknown>, base: PlanBase): void {
  for (const kind of ['strokes', 'shapes', 'icons', 'walls', 'openings'] as const) {
    const items = (base[kind] ?? []) as object[];
    if (items.length === 0) continue;
    let list = variant.get(kind);
    if (!(list instanceof Y.Array)) {
      list = new Y.Array<unknown>();
      variant.set(kind, list);
    }
    (list as Y.Array<unknown>).insert(
      0,
      kind === 'icons' || kind === 'walls' || kind === 'openings'
        ? items.map((i) => new Y.Map<unknown>(Object.entries(i)))
        : items,
    );
  }
  for (const key of ['scale', 'grid', 'rulers', 'roomSizes'] as const)
    if (base[key] !== undefined && variant.get(key) === undefined) variant.set(key, base[key]);
  const ownList = variant.get('circuits');
  const own = {
    circuits:
      ownList instanceof Y.Array
        ? ownList
            .toArray()
            .map((c) => ({ id: c instanceof Y.Map ? c.get('id') : (c as PlanCircuit)?.id }))
        : [],
    ...Object.fromEntries(OWNED.map((k) => [k, variant.get(k)])),
  };
  const { circuits, fields } = standAlone(own, base);
  if (circuits.length) {
    let list = variant.get('circuits');
    if (!(list instanceof Y.Array)) {
      list = new Y.Array<unknown>();
      variant.set('circuits', list);
    }
    (list as Y.Array<unknown>).insert(
      0,
      circuits.map((c) => new Y.Map<unknown>(Object.entries(c))),
    );
  }
  for (const [key, value] of Object.entries(fields))
    if (value === undefined) variant.delete(key);
    else variant.set(key, value);
  variant.delete('variantOf');
}
