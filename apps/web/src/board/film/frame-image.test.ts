// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, updateElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { BoardStore } from '../store.ts';
import { isFrameImageFile, isFrameImageType, moveImageToFrame } from './frame-image.ts';

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
  expect(moveImageToFrame(store, image.id, frame.id)).toBe('moved');
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
  expect(moveImageToFrame(store, image.id, frame.id)).toBe(null);
  expect(store.getSnapshot().byId.has(image.id)).toBe(true);
  store.destroy();
});

it.each([
  ['a drawing', { strokes: [{ id: 's', tool: 'pencil', color: '#000000', width: 2, points: [] }] }],
  ['a crop', { crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }],
  ['a rotation', { rotation: 90 }],
  ['a caption', { caption: 'Marta' }],
])('keeps a card with %s on the board, and takes the picture', (_name, fields) => {
  const store = new BoardStore(createBoardDoc('11111111-1111-4111-8111-111111111111'));
  const image = createElement(
    store.doc,
    'image',
    { x: 0, y: 0 },
    { assetId: 'picture', ...fields },
    { userId: null },
  );
  const frame = createElement(store.doc, 'frame', { x: 0, y: 0 }, {}, { userId: null });
  expect(moveImageToFrame(store, image.id, frame.id)).toBe('kept');
  expect(store.getSnapshot().byId.get(image.id)).toMatchObject(fields);
  expect(store.getSnapshot().byId.get(frame.id)).toMatchObject({ assetId: 'picture' });
  store.destroy();
});

it('tells pictures a frame can show from the ones it cannot', () => {
  expect(isFrameImageFile(new File([''], 'a.png', { type: 'image/png' }))).toBe(true);
  expect(isFrameImageFile(new File([''], 'a.psd', { type: 'image/png' }))).toBe(false);
  expect(isFrameImageType('image/vnd.adobe.photoshop')).toBe(false);
  expect(isFrameImageType('application/pdf')).toBe(false);
});
