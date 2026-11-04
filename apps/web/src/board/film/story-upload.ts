// SPDX-License-Identifier: AGPL-3.0-only
import { updateElement } from '@inkadra/canvas-core';
import { type BoardStore, LOCAL } from '../store.ts';
import { cancelUpload, startUpload, type UploadItem, useUploads } from '../uploads.ts';

export type StoryUploadTarget = 'photo' | 'reference';

/** The uploads each character or location card waits for, kept if its panel closes. */
const waiting = new Map<string, Array<{ key: string; target: StoryUploadTarget }>>();

const forget = (cardId: string, key: string) => {
  const rest = (waiting.get(cardId) ?? []).filter((entry) => entry.key !== key);
  if (rest.length > 0) waiting.set(cardId, rest);
  else waiting.delete(cardId);
};

/**
 * Uploads a picture for a card. The card changes only when all the bytes have arrived, as a
 * single undo step, so a failed upload never costs it the picture it has.
 */
export function uploadToStoryCard(input: {
  store: BoardStore;
  cardId: string;
  target: StoryUploadTarget;
  file: File;
  projectId: string;
  boardId: string;
}) {
  const { store, cardId, target } = input;
  const key = startUpload({
    file: input.file,
    projectId: input.projectId,
    boardId: input.boardId,
    onAsset: () => {},
    onComplete: (assetId) => {
      forget(cardId, key);
      // The latest card: this one may have closed or changed while the file travelled.
      const card = store.getSnapshot().byId.get(cardId);
      if ((card?.type !== 'character' && card?.type !== 'location') || card.locked) return;
      const patch =
        target === 'photo'
          ? { assetId }
          : {
              references: [
                ...new Set([
                  ...(card.type === 'character' ? (card.references ?? []) : []),
                  assetId,
                ]),
              ].slice(0, 60),
            };
      store.undo.stopCapturing();
      updateElement(store.doc, cardId, patch, LOCAL);
      store.undo.stopCapturing();
    },
  });
  forget(cardId, key);
  waiting.set(cardId, [...(waiting.get(cardId) ?? []), { key, target }]);
}

/** Gives up on an upload, for example when the person picks another picture instead. */
export function dropStoryUpload(cardId: string, key: string) {
  forget(cardId, key);
  cancelUpload(key);
}

/** The pictures still on their way to a card, or failed. */
export function useStoryUploads(cardId: string): Array<UploadItem & { target: StoryUploadTarget }> {
  const uploads = useUploads();
  return (waiting.get(cardId) ?? []).flatMap(({ key, target }) => {
    const item = uploads.find((upload) => upload.key === key);
    return item && item.state !== 'done' && item.state !== 'cancelled' ? [{ ...item, target }] : [];
  });
}
