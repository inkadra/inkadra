// SPDX-License-Identifier: MPL-2.0
import { PlanElement as PlanElementSchema, type PlanIcon } from '@inkadra/doc-schema';
import type * as Y from 'yjs';
import {
  layerOf,
  normalizeRotation,
  type PlanElement,
  type PlanItem,
  planListsReady,
} from './plan.ts';
import { type PlanEdit, planItemOwner, writePlanItems } from './plan-editing.ts';
import { type PlanFieldPatch, planFieldWrites, writePlanFields } from './plan-fields.ts';

/**
 * The sun of a set plan (decision 0119): the time and date its sun icons are turned for, on the
 * plan edited (a setup's own), and north, on the base. Where the sun stands is worked out by the
 * caller from the shared astronomy (`sunPosition` for a place with coordinates, else
 * `sunBearingByClock`; `sunRotation` with north, read from `(edit.base ?? edit.plan).north`):
 * the core writes the plan's fields and turns its sun icons with them, in one transaction, so a
 * change of time, day or north is one step.
 */

/** What a change of the sun writes: the sun, north, or both. */
export type PlanSunPatch = Pick<PlanFieldPatch, 'sun' | 'north'>;

/**
 * Whether a sun icon of the plan as drawn may turn: the layers locked are the plan edited's, and
 * for an icon its base holds, the base's too.
 */
function turnable(edit: PlanEdit, icon: PlanIcon): boolean {
  if (icon.locked) return false;
  const layer = layerOf(icon as PlanItem);
  if ((edit.plan.lockedLayers ?? []).includes(layer)) return false;
  const owner = planItemOwner(edit, icon.id);
  return !(owner === edit.base?.id && (edit.base.lockedLayers ?? []).includes(layer));
}

/**
 * The sun icons of the plan as drawn that turn to `rotation` (degrees, any number: brought to
 * 0..359, 0 written as no rotation), with their new rotation. Those already turned so, locked on
 * their own or on a locked layer stay as they are; none for a rotation that is no number.
 */
export function sunTurns(edit: PlanEdit, rotation: number): PlanIcon[] {
  if (!Number.isFinite(rotation)) return [];
  const target = normalizeRotation(rotation);
  return (edit.drawn.icons ?? [])
    .filter((i) => i.kind === 'sun' && turnable(edit, i) && (i.rotation ?? 0) !== target)
    .map((i) => {
      const { rotation: _old, ...rest } = i;
      return target === 0 ? rest : { ...rest, rotation: target };
    });
}

/**
 * A patch as stored: north brought to 0..359, the sun as the schema reads it. Null when either
 * does not read (a field that does not read would leave the whole plan unread).
 */
function storable(patch: PlanSunPatch): PlanSunPatch | null {
  const out: PlanSunPatch = { ...patch };
  if ('north' in patch && patch.north !== undefined) {
    if (!Number.isFinite(patch.north)) return null;
    out.north = normalizeRotation(patch.north);
  }
  if ('sun' in patch && !PlanElementSchema.shape.sun.safeParse(patch.sun).success) return null;
  return out;
}

/**
 * Writes a change of the sun of the plan edited: its fields where each lives (the sun on the plan
 * edited, north on the base of a setup) and its sun icons turned to `rotation`, each on the plan
 * that holds it with what sits on it (writePlanItems), in one transaction. The ids of the icons
 * turned; null when nothing was written because a field does not read or a plan written has a
 * list no client may write yet (planListsReady). Nothing to write, nothing written: [].
 */
export function writePlanSun(
  doc: Y.Doc,
  edit: PlanEdit,
  patch: PlanSunPatch,
  rotation: number,
  origin?: unknown,
): string[] | null {
  const fields = storable(patch);
  if (!fields) return null;
  const turns = sunTurns(edit, rotation);
  const owners = new Set([
    edit.plan.id,
    ...planFieldWrites(edit, fields).map((w) => w.id),
    ...turns.map((i) => planItemOwner(edit, i.id)),
  ]);
  if (!Object.keys(fields).length && !turns.length) return [];
  if ([...owners].some((id) => !planListsReady(doc, id))) return null;
  doc.transact(() => {
    if (Object.keys(fields).length) writePlanFields(doc, edit, fields, origin);
    // Against the plan as drawn (writePlanItems' own baseline): what sits on a sun and settles
    // with it is written field by field too, never over a colleague's edit of it.
    if (turns.length) writePlanItems(doc, edit, turns, origin);
  }, origin);
  return turns.map((i) => i.id);
}

/** A date as the plan's sun stores it. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The sun to write when the shooting day it follows has moved to another date (decision 0119):
 * the same sun on the day's new date, written with its icons turned, synced but no step of
 * anyone's undo. `dayDate` is the followed day's date in the schedule: undefined while the days
 * are not read, null when the day is gone (the plan keeps its last date). Null when there is
 * nothing to repair: no sun or no day followed, the days not read, the day gone or with no date
 * that reads, or the date already right.
 */
export function sunToRepair(
  sun: PlanElement['sun'],
  dayDate: string | null | undefined,
): NonNullable<PlanElement['sun']> | null {
  if (!sun?.day || !dayDate || !DATE.test(dayDate) || sun.date === dayDate) return null;
  return { ...sun, date: dayDate };
}
