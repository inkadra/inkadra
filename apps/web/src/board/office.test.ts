// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, tableGrid } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { officeTable } from './office.ts';
import { BoardStore } from './store.ts';

it('creates the first sheet beside the original and undoes it as one edit', () => {
  const doc = createBoardDoc('board');
  const store = new BoardStore(doc);
  const source = createElement(doc, 'file', { x: 20, y: 30 }, { assetId: 'a' }, { userId: 'u' });
  const id = officeTable(
    store,
    source,
    [
      { name: 'First', rows: [['Name'], ['=1+1']] },
      { name: 'Second', rows: [['Wrong']] },
    ],
    'u',
  );
  const table = store.getSnapshot().byId.get(id ?? '');
  expect(table?.type).toBe('table');
  if (table?.type !== 'table') throw new Error('missing table');
  expect(tableGrid(table)).toEqual([['Name'], ['=1+1']]);
  expect(table.x).toBe(source.x + source.w + 24);
  store.undo.undo();
  expect(store.getSnapshot().byId.has(id ?? '')).toBe(false);
  expect(store.getSnapshot().byId.has(source.id)).toBe(true);
  store.destroy();
});
