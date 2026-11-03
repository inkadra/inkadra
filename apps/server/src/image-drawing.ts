// SPDX-License-Identifier: AGPL-3.0-only
import { roots } from '@inkadra/doc-schema';
import * as Y from 'yjs';

/** Initialize legacy images once on the authority, before any concurrent client can draw. */
export function prepareImageDrawings(doc: Y.Doc) {
  doc.transact(() => {
    for (const map of roots(doc).elements.values()) {
      if (map.get('type') === 'image' && !map.has('strokes')) map.set('strokes',new Y.Array());
    }
  });
}
