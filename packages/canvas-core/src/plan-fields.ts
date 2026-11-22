// SPDX-License-Identifier: MPL-2.0
import type * as Y from 'yjs';
import { updateElements } from './board.ts';
import type { PlanElement } from './plan.ts';
import type { PlanEdit } from './plan-editing.ts';

/**
 * The fields of a plan that belong to the base of its setups, so an editor writes them there
 * (decisions 0104, 0110, 0117): the scale with its grid and rulers, whether the rooms' sizes
 * show, the mains voltage, the picture under the plan, the title, and the set's location and
 * north. `variantView` and `standAlone` each hard-code the fields they take from a base;
 * plan-fields.test.ts checks this list against both. The scenes stay each setup's own (read
 * from the base only when a setup has none), and so does the sun.
 */
export const PLAN_BASE_FIELDS = [
  'title',
  'scale',
  'grid',
  'rulers',
  'roomSizes',
  'voltage',
  'background',
  'locationId',
  'north',
] as const;
export type PlanBaseField = (typeof PLAN_BASE_FIELDS)[number];

/** Lists edited item by item (plan.ts, plan-walls.ts), and what makes a card a plan or a setup. */
const NOT_FIELDS = new Set([
  'id',
  'type',
  'variantOf',
  'strokes',
  'shapes',
  'icons',
  'walls',
  'openings',
  'circuits',
]);

/** A plan's own fields, as a patch: `undefined` removes one. */
export type PlanFieldPatch = Partial<
  Omit<
    PlanElement,
    'id' | 'type' | 'variantOf' | 'strokes' | 'shapes' | 'icons' | 'walls' | 'openings' | 'circuits'
  >
>;

const isBaseField = (field: string): field is PlanBaseField =>
  (PLAN_BASE_FIELDS as readonly string[]).includes(field);

/** The plan a field of the plan edited is written to: the base for a field the setup shows from it. */
export function planFieldOwner(edit: PlanEdit, field: keyof PlanFieldPatch): string {
  return edit.base && isBaseField(field) ? edit.base.id : edit.plan.id;
}

/**
 * The writes of a patch of the plan edited, per card: on a setup, the base's fields go to the
 * base and the rest to the setup. Lists and the fields that make a card a plan or a setup are
 * never written here (their own writers keep the per-item rules).
 */
export function planFieldWrites(
  edit: PlanEdit,
  patch: PlanFieldPatch,
): Array<{ id: string; patch: Record<string, unknown> }> {
  const byOwner = new Map<string, Record<string, unknown>>();
  for (const [field, value] of Object.entries(patch)) {
    if (NOT_FIELDS.has(field)) continue;
    const owner = planFieldOwner(edit, field as keyof PlanFieldPatch);
    const into = byOwner.get(owner) ?? {};
    into[field] = value;
    byOwner.set(owner, into);
  }
  return [...byOwner].map(([id, p]) => ({ id, patch: p }));
}

/** Writes a patch of the plan edited where each field lives, in one transaction. */
export function writePlanFields(
  doc: Y.Doc,
  edit: PlanEdit,
  patch: PlanFieldPatch,
  origin?: unknown,
): void {
  const changes = planFieldWrites(edit, patch);
  if (changes.length) updateElements(doc, changes, origin);
}
