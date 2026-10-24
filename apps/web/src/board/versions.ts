import { migrateBoardDoc, SchemaTooNewError } from '@inkadra/doc-schema';
import type { BoardVersion } from '@inkadra/shared';
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

export type VersionAction = 'read' | 'preview' | 'save' | 'rename' | 'delete' | 'restore';
export type VersionErrorKey =
  | 'rateLimited'
  | 'forbidden'
  | 'notFound'
  | 'limit'
  | 'tooNew'
  | 'unconfirmed'
  | 'generic';

/** Which message explains a failed version request; the 409s of the API differ by action. */
export function versionError(err: unknown, action: VersionAction): VersionErrorKey {
  if (err instanceof SchemaTooNewError) return 'tooNew';
  if (!(err instanceof RequestError)) return 'generic';
  if (err.status === 429) return 'rateLimited';
  if (err.status === 403) return 'forbidden';
  if (err.status === 404) return 'notFound';
  if (err.status === 409) return action === 'save' || action === 'rename' ? 'limit' : 'tooNew';
  // The board may have applied a save or restore it did not confirm in time.
  if (err.status >= 500 && (action === 'save' || action === 'restore')) return 'unconfirmed';
  return 'generic';
}
