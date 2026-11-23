// SPDX-License-Identifier: MPL-2.0
import * as Y from 'yjs';
import { roots } from './doc.ts';

/**
 * A set plan's lists as clients edit them: icons, walls, openings and circuits are Y.Maps in a
 * Y.Array; strokes and shapes plain values in a Y.Array (decisions 0062, 0104).
 */
export const PLAN_MAP_LISTS = ['icons', 'walls', 'openings', 'circuits'] as const;
export const PLAN_PLAIN_LISTS = ['strokes', 'shapes'] as const;
const LISTS = [...PLAN_MAP_LISTS, ...PLAN_PLAIN_LISTS] as const;

const plainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether Yjs takes these values in a Y.Array, tried on a scratch document. */
function accepted(build: () => unknown[]): boolean {
  try {
    new Y.Doc().getArray('try').push(build());
    return true;
  } catch {
    return false;
  }
}

/** How to build the Y.Array of a list, or null when it is one already or cannot become one. */
function builder(key: string, value: unknown): (() => unknown[]) | null {
  if (value instanceof Y.Array) return null;
  if (value !== undefined && !Array.isArray(value)) return null;
  const items = (value as unknown[] | undefined) ?? [];
  const maps = (PLAN_MAP_LISTS as readonly string[]).includes(key);
  if (maps && !items.every(plainObject)) return null;
  const build = maps
    ? () =>
        items.map(
          (i) =>
            new Y.Map(
              Object.entries(i as Record<string, unknown>).filter(([, v]) => v !== undefined),
            ),
        )
    : () => [...items];
  return accepted(build) ? build : null;
}

/**
 * Where a plan stands for editing: `ready` (every list a Y.Array), `pending` (a list missing or
 * plain JSON that the server, or a new card's creator, turns into one) or `stuck` (a list that
 * cannot become one: a value that is no list, or an entry Yjs refuses).
 */
export function planListsState(map: Y.Map<unknown>): 'ready' | 'pending' | 'stuck' {
  let pending = false;
  for (const key of LISTS) {
    const value = map.get(key);
    if (value instanceof Y.Array) continue;
    if (!builder(key, value)) return 'stuck';
    pending = true;
  }
  return pending ? 'pending' : 'ready';
}

/**
 * Turns the lists of one plan into the Yjs types clients edit, every entry kept: a list left as
 * plain JSON is converted, a missing one made empty. A list that cannot become one (see
 * planListsState) is left as it is. Call it inside a transaction, on a map in a document (for a new
 * card, in the transaction that adds it: a map not added yet reads as empty). Returns how many
 * lists it changed.
 *
 * Only one writer may do this for a card everyone already has: the server when it loads a board
 * (two clients converting at once would each keep a list of their own and lose the other's
 * items; decision of 23 Nov). A client may do it for a card it is creating, which nobody else
 * has yet (a paste).
 */
export function preparePlanListsOf(map: Y.Map<unknown>): number {
  if (map.get('type') !== 'plan') return 0;
  let changed = 0;
  for (const key of LISTS) {
    const build = builder(key, map.get(key));
    if (!build) continue;
    const list = new Y.Array<unknown>();
    list.push(build());
    map.set(key, list);
    changed += 1;
  }
  return changed;
}

/**
 * Every set plan of a board prepared (preparePlanListsOf), in one transaction: what the server
 * does when it loads a board or restores a version, before any client syncs. Nothing at all on a
 * board already in shape (two loads, one conversion). Returns how many lists it changed.
 */
export function preparePlanLists(doc: Y.Doc): number {
  // Every plan with a list to make or convert, even one with another list that cannot be.
  const plans = [...roots(doc).elements.values()].filter(
    (map) => map.get('type') === 'plan' && LISTS.some((key) => builder(key, map.get(key))),
  );
  if (plans.length === 0) return 0;
  let changed = 0;
  doc.transact(() => {
    for (const map of plans) changed += preparePlanListsOf(map);
  });
  return changed;
}
