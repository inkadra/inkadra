// SPDX-License-Identifier: AGPL-3.0-only
import { MAX_STROKES, newElementId, roots, Stroke } from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { LOCAL } from './store.ts';

/** Append to the authority's shared array; recover a missing field without replacing existing ink. */
export function appendImageStroke(doc: Y.Doc, id: string, points: number[]): boolean {
  const map = roots(doc).elements.get(id);
  if (map?.get('type') !== 'image') return false;
  let strokes = map.get('strokes');
  // Restores and rollout imports can remove this field while the board remains loaded.
  // shortcut: simultaneous recovery by offline clients can replace one array; upgrade to
  // authority-coordinated recovery before supporting concurrent legacy restores offline.
  if (strokes === undefined) {
    strokes = new Y.Array();
    doc.transact(() => map.set('strokes', strokes), LOCAL);
  }
  if (!(strokes instanceof Y.Array) || strokes.length >= MAX_STROKES) return false;
  const stroke = Stroke.safeParse({
    id: newElementId(),
    tool: 'pencil',
    color: '#E5484D',
    width: 3,
    points,
  });
  if (!stroke.success) return false;
  const target = strokes;
  doc.transact(() => target.push([stroke.data]), LOCAL);
  return true;
}
