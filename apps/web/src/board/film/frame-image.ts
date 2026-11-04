// SPDX-License-Identifier: AGPL-3.0-only
import { deleteElements, updateElement } from '@inkadra/canvas-core';
import { type Element, hiddenFromGuests } from '@inkadra/doc-schema';
import { isRawImageType } from '@inkadra/shared';
import { isDesignFile } from '../file-kinds.ts';
import { type BoardStore, LOCAL } from '../store.ts';

/** What a frame shows: pictures browsers draw, so no Photoshop or camera RAW files. */
export const isFrameImageType = (mime: string) =>
  mime.startsWith('image/') && !mime.includes('photoshop') && !isRawImageType(mime);
export const isFrameImageFile = (file: File) =>
  isFrameImageType(file.type) && !isDesignFile(file.name);

/** A frame has no place for these: the card that holds them must not go. */
function holdsOwnData(image: Extract<Element, { type: 'image' }>) {
  return (
    (image.strokes?.length ?? 0) > 0 ||
    !!image.crop ||
    !!image.rotation ||
    !!image.caption?.trim()
  );
}

/**
 * Puts a board picture into a frame, preserving the frame's drawing; undo restores both cards.
 * The card goes (`moved`), unless it holds a drawing, crop, rotation or caption (`kept`).
 */
export function moveImageToFrame(
  store: BoardStore,
  imageId: string,
  frameId: string,
): 'moved' | 'kept' | null {
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
    return null;
  const kept = holdsOwnData(image);
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
    if (!kept) deleteElements(store.doc, [image.id], LOCAL);
  }, LOCAL);
  store.undo.stopCapturing();
  return kept ? 'kept' : 'moved';
}
