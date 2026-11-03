import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc, readElement, roots } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendImageStroke } from './image-drawing.ts';

it('merges the first simultaneous strokes on an initialized image and rejects invalid coordinates', () => {
  const doc = createBoardDoc('boardAAAAAAAA');
  const image = createElement(doc,'image',{x:0,y:0},{assetId:'imageAAAAAAAA'},{userId:null});
  const other = new Y.Doc(); Y.applyUpdate(other,Y.encodeStateAsUpdate(doc));
  expect(appendImageStroke(doc,image.id,[0,0,4096,4096])).toBe(true);
  expect(appendImageStroke(other,image.id,[4096,0,0,4096])).toBe(true);
  Y.applyUpdate(doc,Y.encodeStateAsUpdate(other));
  const result = readElement(roots(doc).elements.get(image.id)!);
  expect(result?.type === 'image' && result.strokes).toHaveLength(2);
  expect(appendImageStroke(doc,image.id,[-1,0])).toBe(false);
  expect(appendImageStroke(doc,image.id,[1])).toBe(false);
  expect(appendImageStroke(doc,'missing',[0,0])).toBe(false);
});
