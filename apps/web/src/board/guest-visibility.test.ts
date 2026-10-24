import { createElement, moveIntoParent, moveToCanvas } from '@inkadra/canvas-core';
import { createBoardDoc, hiddenFromGuests } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { toggleGuestHidden } from './guest-visibility.tsx';
import { BoardStore } from './store.ts';

it('toggles multiple explicit flags in one undo step without changing inherited flags', () => {
  const doc = createBoardDoc('board');
  const column = createElement(
    doc,
    'column',
    { x: 0, y: 0 },
    { title: 'Column' },
    { userId: null },
  );
  const card = createElement(doc, 'note', { x: 20, y: 20 }, {}, { userId: null });
  const other = createElement(doc, 'note', { x: 50, y: 30 }, {}, { userId: null });
  moveIntoParent(doc, [card.id], column.id, 0);
  const store = new BoardStore(doc);
  const hidden = (id: string) => hiddenFromGuests(id, (key) => store.getSnapshot().byId.get(key));
  toggleGuestHidden(store, [column.id, other.id]);
  expect(hidden(card.id)).toBe(true);
  expect(store.getSnapshot().byId.get(card.id)?.guestHidden).toBeUndefined();
  expect(hidden(other.id)).toBe(true);
  store.undo.undo();
  expect(hidden(card.id)).toBe(false);
  expect(hidden(other.id)).toBe(false);
  store.undo.redo();
  moveToCanvas(doc, [{ id: card.id, x: 0, y: 0 }]);
  expect(hidden(card.id)).toBe(false);
  toggleGuestHidden(store, [column.id, other.id]);
  expect(hidden(column.id)).toBe(false);
  expect(hidden(other.id)).toBe(false);
  store.destroy();
  doc.destroy();
});
