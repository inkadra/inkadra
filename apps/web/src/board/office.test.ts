// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, tableGrid } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { isNumeric, officeTable, officeUrl, tableable } from './office.ts';
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

it('refuses a first sheet with rows left out: a partial budget never reaches the board', () => {
  const doc = createBoardDoc('board');
  const store = new BoardStore(doc);
  const source = createElement(doc, 'file', { x: 0, y: 0 }, { assetId: 'a' }, { userId: 'u' });
  expect(
    officeTable(store, source, [{ name: 'Big', rows: [['a']], truncated: true }], 'u'),
  ).toBeNull();
  expect(tableable({ name: 'Big', rows: [], truncated: true })).toBe(false);
  expect(tableable({ name: 'Ok', rows: [['a']] })).toBe(true);
  store.destroy();
});

it('puts the revision on pages, so a reprocessed document is not stuck in the cache', () => {
  expect(officeUrl('a')).toBe('/api/v1/assets/a/office/manifest.json');
  expect(officeUrl('a', 'page-2.webp', 'r 1')).toBe('/api/v1/assets/a/office/page-2.webp?v=r%201');
  expect(['12', '-3,5', '25%', '.5'].every(isNumeric)).toBe(true);
  expect(['2025-11-02', '12 kg', '', '1.2.3'].some(isNumeric)).toBe(false);
});
