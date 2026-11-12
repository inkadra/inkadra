// SPDX-License-Identifier: AGPL-3.0-only
import { canvasElements, createElement, listElements, sendToBack } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { readableElements } from './export.ts';

it('writes the elements of a board in the order the board draws them', () => {
  const doc = createBoardDoc('11111111-1111-4111-8111-111111111111');
  const opts = { userId: null };
  const first = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  const second = createElement(doc, 'note', { x: 0, y: 0 }, {}, opts);
  // Sending a card to the back gives it a key before `a0` (`Zz`): collation put it last.
  sendToBack(doc, [second.id]);
  const drawn = canvasElements(listElements(doc)).map((e) => e.id);
  expect(drawn).toEqual([second.id, first.id]);
  expect(readableElements(doc).map((e) => e.id)).toEqual(drawn);
});
