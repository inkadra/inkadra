import { roots } from '@inkadra/doc-schema';
import * as Y from 'yjs';

/** A plan's lists: icons, walls, openings and circuits are Y.Maps in a Y.Array; strokes and
 * shapes plain objects in a Y.Array (doc-schema `addElement`, decisions 0062, 0104). */
const MAP_LISTS = ['icons', 'walls', 'openings', 'circuits'] as const;
const PLAIN_LISTS = ['strokes', 'shapes'] as const;

const plainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The Y.Maps of a list's items, or null when one of them cannot be one (tried on a scratch doc). */
function asMaps(items: readonly unknown[]): (() => Y.Map<unknown>[]) | null {
  if (!items.every(plainObject)) return null;
  const build = () =>
    items.map(
      (i) =>
        new Y.Map(Object.entries(i as Record<string, unknown>).filter(([, v]) => v !== undefined)),
    );
  try {
    new Y.Doc().getArray('try').push(build());
  } catch {
    return null;
  }
  return build;
}

/**
 * Before a board is served (load, version restore), every set plan's lists become the Yjs types
 * clients edit: a list an older writer left as plain JSON is converted with all its items, and a
 * missing one is made empty. Done here, by the one process that holds the document before any
 * client syncs, so no two clients each convert or make a list of their own (Yjs keeps one per key
 * and the other client's items would be lost; decision of 23 Nov). One transaction, nothing when
 * every list is already a Y.Array (two loads, one conversion).
 *
 * Nothing is dropped: strokes and shapes keep every entry as it is, even one that does not read;
 * a list of icons, walls, openings or circuits holding an entry that cannot become a Y.Map (no
 * object, or a value Yjs refuses) is left as it is, and clients refuse to edit it. A value that is
 * neither a list nor missing is left too, for a newer build. Returns how many lists it changed.
 */
export function preparePlanLists(doc: Y.Doc): number {
  const work: Array<{ map: Y.Map<unknown>; key: string; items: () => unknown[] }> = [];
  for (const map of roots(doc).elements.values()) {
    if (map.get('type') !== 'plan') continue;
    for (const key of [...MAP_LISTS, ...PLAIN_LISTS]) {
      const value = map.get(key);
      if (value instanceof Y.Array) continue;
      if (value !== undefined && !Array.isArray(value)) continue;
      const items = (value as unknown[] | undefined) ?? [];
      if ((PLAIN_LISTS as readonly string[]).includes(key)) {
        work.push({ map, key, items: () => [...items] });
        continue;
      }
      const maps = asMaps(items);
      if (maps) work.push({ map, key, items: maps });
    }
  }
  if (work.length === 0) return 0;
  doc.transact(() => {
    for (const { map, key, items } of work) {
      const list = new Y.Array<unknown>();
      list.push(items());
      map.set(key, list);
    }
  });
  return work.length;
}
