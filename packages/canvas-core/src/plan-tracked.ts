// SPDX-License-Identifier: MPL-2.0
import type { PlanElement } from './plan.ts';

/**
 * The fields of a set plan that two people can change at once and that a client should not
 * settle silently: texts and production data, not positions, sizes, angles, order or locks
 * (those go to the last writer). Every client names them the same way, so "the same field"
 * means the same thing on the web and in the app (decision 0116).
 */
export const TRACKED_PLAN_FIELDS = ['title', 'variant', 'voltage'] as const;
export const TRACKED_ICON_FIELDS = [
  'label',
  'note',
  'stepNote',
  'role',
  'make',
  'power',
  'watts',
  'gel',
  'stand',
  'support',
  'kelvin',
  'lens',
  'circuit',
  'frameId',
  'characterId',
] as const;
export const TRACKED_LIST_FIELDS = {
  walls: ['label'],
  openings: ['label'],
  circuits: ['name', 'amps'],
  shapes: ['text'],
} as const;

/**
 * The tracked values of a plan by key: a plan field by its name (`title`), an item's field as
 * `<list>.<item id>.<field>` (`icons.<id>.label`, `circuits.<id>.amps`). Each value is its JSON,
 * or null when the field is not set. Comparing two readings of the same plan gives the fields
 * that changed between them.
 */
export function trackedPlanValues(
  plan: Pick<PlanElement, 'icons' | 'walls' | 'openings' | 'circuits' | 'shapes'> &
    Partial<Pick<PlanElement, (typeof TRACKED_PLAN_FIELDS)[number]>>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const put = (key: string, value: unknown) =>
    out.set(key, value === undefined ? null : JSON.stringify(value));
  for (const field of TRACKED_PLAN_FIELDS) put(field, plan[field]);
  for (const icon of plan.icons ?? [])
    for (const field of TRACKED_ICON_FIELDS) put(`icons.${icon.id}.${field}`, icon[field]);
  for (const [list, fields] of Object.entries(TRACKED_LIST_FIELDS) as Array<
    [keyof typeof TRACKED_LIST_FIELDS, readonly string[]]
  >)
    for (const item of (plan[list] ?? []) as ReadonlyArray<{ id: string }>)
      for (const field of fields)
        put(`${list}.${item.id}.${field}`, (item as Record<string, unknown>)[field]);
  return out;
}
