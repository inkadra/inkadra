import { migrateBoardDoc, SchemaTooNewError } from '@inkadra/doc-schema';
import { type BoardVersion, BoardVersionConflict, OutcomeUnknown } from '@inkadra/shared';
import * as Y from 'yjs';
import { RequestError } from '../lib/api.ts';
import { BoardStore } from './store.ts';

/** A preview never shares CRDT types or undo history with the connected document. */
export function versionStore(update: Uint8Array, boardId: string): BoardStore {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    migrateBoardDoc(doc, boardId);
    return new BoardStore(doc);
  } catch (err) {
    doc.destroy();
    throw err;
  }
}

/** Local calendar days, preserving the server's newest-first order across pages. */
export function groupVersions(items: BoardVersion[]): Array<{ day: Date; items: BoardVersion[] }> {
  const groups = new Map<string, { day: Date; items: BoardVersion[] }>();
  for (const item of items) {
    const day = new Date(item.createdAt);
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    let group = groups.get(key);
    if (!group) {
      group = { day, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

/**
 * Applies a local change to the pages already loaded, in the server's order (newest first, then
 * id), so a save, rename or delete never drops the versions loaded with "load more".
 */
export function mergeVersions(
  items: readonly BoardVersion[],
  changed: readonly BoardVersion[],
  removed: readonly string[] = [],
): BoardVersion[] {
  const byId = new Map(items.map((v) => [v.id, v]));
  for (const v of changed) byId.set(v.id, v);
  for (const id of removed) byId.delete(id);
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

export type VersionAction = 'read' | 'preview' | 'save' | 'rename' | 'delete' | 'restore';
export type VersionErrorKey =
  | 'rateLimited'
  | 'forbidden'
  | 'notFound'
  | 'limit'
  | 'tooNew'
  | 'unconfirmed'
  | 'generic';

/** Which message explains a failed version request; legacy 409s without a reason differ by action. */
export function versionError(err: unknown, action: VersionAction): VersionErrorKey {
  if (err instanceof SchemaTooNewError) return 'tooNew';
  if (!(err instanceof RequestError)) return 'generic';
  if (err.status === 429) return 'rateLimited';
  if (err.status === 403) return 'forbidden';
  if (err.status === 404) return 'notFound';
  if (err.status === 409) {
    const conflict = BoardVersionConflict.safeParse(err.details);
    if (conflict.success)
      return conflict.data.reason === 'named_versions_limit' ? 'limit' : 'tooNew';
    return action === 'save' || action === 'rename' ? 'limit' : 'tooNew';
  }
  // The board may have applied a save or restore it did not confirm in time. Servers before
  // decision 0017 send no reason, so a 500 of either stays unconfirmed (never "not done").
  if (err.status >= 500 && OutcomeUnknown.safeParse(err.details).success) return 'unconfirmed';
  if (err.status >= 500 && (action === 'save' || action === 'restore')) return 'unconfirmed';
  return 'generic';
}
