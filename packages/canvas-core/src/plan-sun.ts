// SPDX-License-Identifier: MPL-2.0

import type { PlanIcon } from '@inkadra/doc-schema';
import type * as Y from 'yjs';
import { layerOf, type PlanElement, type PlanItem, updatePlanItems } from './plan.ts';
import { type PlanEdit, planItemOwner } from './plan-editing.ts';
import { type PlanFieldPatch, writePlanFields } from './plan-fields.ts';

/**
 * The sun of a set plan (decision 0119): the time and date its sun icons are turned for, on the
 * plan edited (a setup's own), and north, on the base. Where the sun stands is worked out by the
 * caller from the shared astronomy (`sunPosition` for a place with coordinates, else
 * `sunBearingByClock`; `sunRotation` with north): the core writes the plan's fields and turns
 * its sun icons with them, in one transaction, so a change of time, day or north is one step.
 */

/** What a change of the sun writes: the sun, north, or both. */
export type PlanSunPatch = Pick<PlanFieldPatch, 'sun' | 'north'>;

const lockedLayers = (edit: PlanEdit) =>
  new Set([...(edit.plan.lockedLayers ?? []), ...(edit.base?.lockedLayers ?? [])]);

/**
 * The sun icons of the plan as drawn that turn to `rotation` (degrees), with their new rotation:
 * those already turned so, and those on a locked layer or locked on their own, stay as they are.
 */
export function sunTurns(edit: PlanEdit, rotation: number): PlanIcon[] {
  const locked = lockedLayers(edit);
  return (edit.drawn.icons ?? [])
    .filter(
      (i) =>
        i.kind === 'sun' &&
        !i.locked &&
        !locked.has(layerOf(i as PlanItem)) &&
        (i.rotation ?? 0) !== rotation,
    )
    .map((i) => ({ ...i, rotation }));
}

/**
 * Writes a change of the sun of the plan edited: its fields where each lives (the sun on the plan
 * edited, north on the base of a setup) and its sun icons turned to `rotation`, each on the plan
 * that holds it, in one transaction. A patch with nothing in it and no icon to turn writes
 * nothing. The ids of the icons turned.
 */
export function writePlanSun(
  doc: Y.Doc,
  edit: PlanEdit,
  patch: PlanSunPatch,
  rotation: number,
  origin?: unknown,
): string[] {
  const turns = sunTurns(edit, rotation);
  const fields = Object.keys(patch).length > 0;
  if (!fields && !turns.length) return [];
  const drawn = new Map((edit.drawn.icons ?? []).map((i) => [i.id, i as PlanItem]));
  const byOwner = new Map<string, PlanIcon[]>();
  for (const icon of turns) {
    const owner = planItemOwner(edit, icon.id);
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), icon]);
  }
  doc.transact(() => {
    if (fields) writePlanFields(doc, edit, patch, origin);
    for (const [owner, icons] of byOwner)
      updatePlanItems(
        doc,
        owner,
        icons,
        origin,
        icons.flatMap((i) => drawn.get(i.id) ?? []),
      );
  }, origin);
  return turns.map((i) => i.id);
}

/**
 * The sun to write when the shooting day it follows has moved to another date (decision 0119):
 * the same sun on the day's new date, written with its icons turned, synced but no step of
 * anyone's undo. `dayDate` is the followed day's date in the schedule: undefined while the days
 * are not read, null when the day is gone (the plan keeps its last date). Null when there is
 * nothing to repair: no day followed, the days not read, the day gone, or the date already right.
 */
export function sunToRepair(
  sun: PlanElement['sun'],
  dayDate: string | null | undefined,
): NonNullable<PlanElement['sun']> | null {
  if (!sun?.day || !dayDate || sun.date === dayDate) return null;
  return { ...sun, date: dayDate };
}
