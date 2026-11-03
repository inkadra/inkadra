import { addElement, createBoardDoc, roots } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { prepareImageDrawings } from './image-drawing.ts';

it('prepares old images once before synchronization and preserves the shared array', () => {
  const doc = createBoardDoc('boardAAAAAAAA');
  addElement(doc, {
    id: 'imageAAAAAAAA',
    type: 'image',
    assetId: 'assetAAAAAAAA',
    x: 0,
    y: 0,
    w: 240,
    z: 'a0',
    parent: null,
    createdAt: 0,
    createdBy: null,
  });
  prepareImageDrawings(doc);
  const strokes = roots(doc).elements.get('imageAAAAAAAA')!.get('strokes');
  expect(strokes).toBeInstanceOf(Y.Array);
  prepareImageDrawings(doc);
  expect(roots(doc).elements.get('imageAAAAAAAA')!.get('strokes')).toBe(strokes);
});
