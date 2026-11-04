// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, updateElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { BoardStore } from '../store.ts';
import { moveImageToFrame } from './frame-image.ts';

it('moves one image without losing frame data and restores both cards on undo', () => {
  const store = new BoardStore(createBoardDoc('11111111-1111-4111-8111-111111111111'));
  const image = createElement(
    store.doc,
    'image',
    { x: 90, y: 80 },
    { assetId: 'picture', guestHidden: true },
    { userId: null },
  );
  const frame = createElement(
    store.doc,
    'frame',
    { x: 0, y: 0 },
    { assetId: 'old', notes: 'Keep this', referenceOpacity: 0.4 },
    { userId: null },
  );
  expect(moveImageToFrame(store, image.id, frame.id)).toBe(true);
  expect(store.getSnapshot().byId.has(image.id)).toBe(false);
  expect(store.getSnapshot().byId.get(frame.id)).toMatchObject({
    assetId: 'picture',
    notes: 'Keep this',
    referenceOpacity: 0.4,
    guestHidden: true,
  });
  store.undo.undo();
  expect(store.getSnapshot().byId.get(image.id)).toMatchObject(image);
  expect(store.getSnapshot().byId.get(frame.id)).toMatchObject(frame);
  updateElement(store.doc, frame.id, { locked: true });
  expect(moveImageToFrame(store, image.id, frame.id)).toBe(false);
  expect(store.getSnapshot().byId.has(image.id)).toBe(true);
  store.destroy();
});
