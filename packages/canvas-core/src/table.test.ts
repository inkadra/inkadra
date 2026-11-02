// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, type Element, roots, validateBoardDoc } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import { createElement, duplicateElements, listElements } from './board.ts';
import {
  fillTable,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  newTable,
  parseTsv,
  removeTableColumn,
  removeTableRow,
  setTableCell,
  setTableColumnWidth,
  tableGrid,
  toTsv,
} from './table.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
type Table = Extract<Element, { type: 'table' }>;

function setup(columns = 2, rows = 2) {
  const doc = createBoardDoc(boardId);
  const el = createElement(doc, 'table', { x: 0, y: 0 }, newTable(columns, rows), {
    userId: null,
  });
  const read = () => listElements(doc).find((e) => e.id === el.id) as Table;
  return { doc, id: el.id, read };
}

describe('table cards', () => {
  it('edits cells and keeps the document valid', () => {
    const { doc, id, read } = setup();
    const [c0, c1] = read().columns;
    const [r0] = read().rows;
    setTableCell(doc, id, r0!.id, c0!.id, 'Matteo');
    setTableCell(doc, id, r0!.id, c1!.id, 'Lagunc');
    setTableCell(doc, id, r0!.id, c1!.id, '');
    expect(tableGrid(read())).toEqual([
      ['Matteo', ''],
      ['', ''],
    ]);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('adds, removes and reorders rows and columns', () => {
    const { doc, id, read } = setup();
    fillTable(doc, id, 0, 0, [
      ['a', 'b'],
      ['c', 'd'],
    ]);
    insertTableRow(doc, id, 0);
    const col = insertTableColumn(doc, id, 1) as string;
    expect(tableGrid(read())).toEqual([
      ['', '', ''],
      ['a', '', 'b'],
      ['c', '', 'd'],
    ]);
    moveTableRow(doc, id, 0, 2);
    moveTableColumn(doc, id, 1, 0);
    expect(tableGrid(read())).toEqual([
      ['', 'a', 'b'],
      ['', 'c', 'd'],
      ['', '', ''],
    ]);
    removeTableColumn(doc, id, col);
    removeTableRow(doc, id, read().rows[2]!.id);
    expect(tableGrid(read())).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    // A table keeps at least one column.
    removeTableColumn(doc, id, read().columns[0]!.id);
    removeTableColumn(doc, id, read().columns[0]!.id);
    expect(read().columns).toHaveLength(1);
    expect(validateBoardDoc(doc)).toEqual([]);
  });

  it('grows to fit a pasted grid and clamps column widths', () => {
    const { doc, id, read } = setup(1, 1);
    expect(fillTable(doc, id, 0, 0, [['Operatore', 'Zona', 'Mappa'], ['Niccolò']])).toEqual({
      rows: 2,
      columns: 3,
    });
    expect(tableGrid(read())).toEqual([
      ['Operatore', 'Zona', 'Mappa'],
      ['Niccolò', '', ''],
    ]);
    setTableColumnWidth(doc, id, read().columns[0]!.id, 10);
    expect(read().columns[0]!.width).toBe(40);
    setTableColumnWidth(doc, id, read().columns[0]!.id, undefined);
    expect(read().columns[0]!.width).toBeUndefined();
  });

  it('duplicates a table with its own rows', () => {
    const { doc, id, read } = setup(1, 1);
    setTableCell(doc, id, read().rows[0]!.id, read().columns[0]!.id, 'x');
    const [copyId] = duplicateElements(doc, [id], { x: 10, y: 10 }, { userId: null });
    setTableCell(doc, id, read().rows[0]!.id, read().columns[0]!.id, 'y');
    const copy = listElements(doc).find((e) => e.id === copyId) as Table;
    expect(tableGrid(copy)).toEqual([['x']]);
    expect(roots(doc).elements.size).toBe(2);
  });
});

describe('TSV', () => {
  it('reads what spreadsheets copy, quoted cells included', () => {
    expect(parseTsv('a\tb\r\n"two\nlines"\t"say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['two\nlines', 'say "hi"'],
    ]);
    expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
  });

  it('marks formula-like cells with an apostrophe in the copy, not numbers, and reads them back', () => {
    const grid = [['=SUM(A1:A2)', '+1+1', '@cmd', '-1+2', '-5', '+3,5', '25%', 'plain', '-dash']];
    expect(toTsv(grid)).toBe("'=SUM(A1:A2)\t'+1+1\t'@cmd\t'-1+2\t-5\t+3,5\t25%\tplain\t'-dash");
    expect(parseTsv(toTsv(grid))).toEqual(grid);
  });

  it('round-trips through toTsv', () => {
    const grid = [
      ['Operatore', 'Note'],
      ['Matteo', 'tab\there "quoted"'],
    ];
    expect(parseTsv(toTsv(grid))).toEqual(grid);
  });
});
