import { addElement, createBoardDoc, Element, roots } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { scheduleSource } from './board-content.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-0000000000aa';

it('reads a stored document migrated, as the live one reads (#826)', () => {
  const doc = createBoardDoc(boardId);
  roots(doc).meta.set('schemaVersion', 25);
  const walker = {
    id: 'iconAAAAAAAAA',
    kind: 'actor',
    color: '#7AD689',
    x: 100,
    y: 100,
    steps: [{ x: 10, y: 10, note: 'Comes in' }],
    note: 'Sits down',
  };
  const plan = Element.parse({
    id: 'planAAAAAAAAA',
    x: 0,
    y: 0,
    w: 240,
    z: 'a0',
    parent: null,
    createdBy: null,
    createdAt: 0,
    type: 'plan',
    strokes: [],
    shapes: [],
    icons: [walker],
  });
  addElement(doc, plan);
  const { elements } = scheduleSource(boardId, Y.encodeStateAsUpdate(doc));
  const read = elements.find((el) => el.id === plan.id);
  if (read?.type !== 'plan') throw new Error('not a plan');
  // Version 26 moved this note: unmigrated, the call sheet would show it as the item's own.
  expect(read.icons?.[0]).toMatchObject({ stepNote: 'Sits down' });
  expect(read.icons?.[0]).not.toHaveProperty('note');
});
