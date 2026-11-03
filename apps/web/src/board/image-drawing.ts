// SPDX-License-Identifier: AGPL-3.0-only
import { MAX_STROKES, newElementId, roots, Stroke } from '@inkadra/doc-schema';
import * as Y from 'yjs';
import { LOCAL } from './store.ts';

/** Never replace the shared array on the first stroke: old images are prepared by the server. */
export function appendImageStroke(doc: Y.Doc, id: string, points: number[]): boolean {
  const map = roots(doc).elements.get(id);
  const strokes = map?.get('strokes');
  if (
    map?.get('type') !== 'image' ||
    !(strokes instanceof Y.Array) ||
    strokes.length >= MAX_STROKES
  )
    return false;
  const stroke = Stroke.safeParse({
    id: newElementId(),
    tool: 'pencil',
    color: '#E5484D',
    width: 3,
    points,
  });
  if (!stroke.success) return false;
  doc.transact(() => strokes.push([stroke.data]), LOCAL);
  return true;
}
