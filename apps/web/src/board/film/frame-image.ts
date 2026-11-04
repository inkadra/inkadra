// SPDX-License-Identifier: AGPL-3.0-only
import { deleteElements, updateElement } from '@inkadra/canvas-core';
import { hiddenFromGuests } from '@inkadra/doc-schema';
import { type BoardStore, LOCAL } from '../store.ts';

/** Move a board picture into a frame, preserving the drawing; undo restores both cards. */
export function moveImageToFrame(store: BoardStore, imageId: string, frameId: string): boolean {
  const { byId } = store.getSnapshot();
  const image = byId.get(imageId);
  const frame = byId.get(frameId);
  if (
    image?.type !== 'image' ||
    !image.assetId ||
    image.locked ||
    frame?.type !== 'frame' ||
    frame.locked
  )
    return false;
  store.undo.stopCapturing();
  store.doc.transact(() => {
    updateElement(
      store.doc,
      frame.id,
      {
        assetId: image.assetId,
        source: image.source,
        ...(hiddenFromGuests(image.id, (id) => byId.get(id)) ? { guestHidden: true } : {}),
      },
      LOCAL,
    );
    deleteElements(store.doc, [image.id], LOCAL);
  }, LOCAL);
  store.undo.stopCapturing();
  return true;
}
