import {
  PLAN_MAP_LISTS,
  PLAN_PLAIN_LISTS,
  planListsState,
  preparePlanListsOf,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';

const LIST_KEYS: ReadonlySet<string> = new Set([...PLAN_MAP_LISTS, ...PLAN_PLAIN_LISTS]);

/**
 * While a board stays open, a set plan list that arrives missing or as plain JSON (a paste or an
 * edit from a client older than the rule that clients never make plan lists) is prepared by the
 * server right after, as at load (doc-schema preparePlanListsOf), so "reload the board" is never
 * needed while someone keeps it open. Only the plans a transaction touched are looked at. Returns
 * the function that stops watching.
 */
export function preparePlanListsOnChange(doc: Y.Doc): () => void {
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
        type.get('type') === 'plan' &&
        [...keys].some((k) => k !== null && LIST_KEYS.has(k))
      )
        touched.add(type as Y.Map<unknown>);
    }
    const due = [...touched].filter((map) => planListsState(map) === 'pending');
    // After this transaction, as one of the server's own (its observers have all run).
    if (due.length)
      queueMicrotask(() =>
        doc.transact(() => {
          for (const map of due) if (map.doc === doc) preparePlanListsOf(map);
        }),
      );
  };
  doc.on('afterTransaction', watch);
  return () => doc.off('afterTransaction', watch);
}
