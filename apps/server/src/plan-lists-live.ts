import {
  PLAN_MAP_LISTS,
  PLAN_PLAIN_LISTS,
  planListsDuplicated,
  planListsState,
  preparePlanListsOf,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';

const LIST_KEYS: ReadonlySet<string> = new Set([...PLAN_MAP_LISTS, ...PLAN_PLAIN_LISTS]);

/**
 * While a board stays open, a set plan list that arrives missing or as plain JSON (a paste or an
 * edit from a client older than the rule that clients never make plan lists) is prepared by the
 * server right after, as at load (doc-schema preparePlanListsOf), so "reload the board" is never
 * needed while someone keeps it open. So are two entries with one id in a list (two clients
 * moving the same item into a base at once, issue #1033): the later one is removed, by the server
 * alone, so no two clients ever race to do it. Only the plans a transaction touched are looked at; as at
 * load, a plan's convertible lists are prepared even when another of its lists cannot be. A
 * failure is handed to `onError` (the board's problem report), never thrown into Yjs. Returns the
 * function that stops watching.
 */
export function preparePlanListsOnChange(doc: Y.Doc, onError: (err: unknown) => void): () => void {
  const elements = doc.getMap<Y.Map<unknown>>('elements');
  const watch = (tr: Y.Transaction) => {
    const touched = new Set<Y.Map<unknown>>();
    for (const [type, keys] of tr.changed) {
      if ((type as unknown) === elements) {
        for (const id of keys) {
          const map = id === null ? undefined : elements.get(id);
          if (map?.get('type') === 'plan') touched.add(map);
        }
      } else if (
        type instanceof Y.Map &&
        type.parent === elements &&
        type.get('type') === 'plan' &&
        [...keys].some((k) => k !== null && LIST_KEYS.has(k))
      )
        touched.add(type as Y.Map<unknown>);
      // An entry added to or removed from one of a plan's lists.
      else if (type instanceof Y.Array && type.parent instanceof Y.Map) {
        const plan = type.parent as Y.Map<unknown>;
        if (plan.parent === elements && plan.get('type') === 'plan') touched.add(plan);
      }
    }
    // Pending, or stuck with other lists still to prepare (preparePlanListsOf skips what cannot be).
    const due = [...touched].filter(
      (map) => planListsState(map) !== 'ready' || planListsDuplicated(map),
    );
    // After this transaction, as one of the server's own (its observers have all run).
    if (due.length)
      queueMicrotask(() => {
        try {
          doc.transact(() => {
            for (const map of due) if (map.doc === doc) preparePlanListsOf(map);
          });
        } catch (err) {
          onError(err);
        }
      });
  };
  doc.on('afterTransaction', watch);
  return () => doc.off('afterTransaction', watch);
}
