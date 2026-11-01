// SPDX-License-Identifier: MPL-2.0
import {
  type Element,
  MAX_TABLE_CELL,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  newElementId,
  roots,
  type TableRow,
  tableRowMap,
} from '@inkadra/doc-schema';
import * as Y from 'yjs';

/**
 * Edits on a table card (decision 0052). Columns and rows are Y.Arrays of Y.Maps and the cells
 * of a row a Y.Map, so two people typing in different cells, or adding rows, merge. Moving a
 * row copies it to its new place: an edit made to it at the same moment elsewhere is lost.
 */

type TableElement = Extract<Element, { type: 'table' }>;

/** Fields of a new, empty table of `columns` × `rows`. */
export function newTable(columns = 3, rows = 3): Pick<TableElement, 'columns' | 'rows'> {
  return {
    columns: Array.from({ length: columns }, () => ({ id: newElementId() })),
    rows: Array.from({ length: rows }, () => ({ id: newElementId(), cells: {} })),
  };
}

function parts(doc: Y.Doc, id: string) {
  const map = roots(doc).elements.get(id);
  const columns = map?.get('columns');
  const rows = map?.get('rows');
  if (!(columns instanceof Y.Array) || !(rows instanceof Y.Array)) return null;
  return { columns: columns as Y.Array<Y.Map<unknown>>, rows: rows as Y.Array<Y.Map<unknown>> };
}

function cellsOf(row: Y.Map<unknown> | undefined): Y.Map<string> | null {
  const cells = row?.get('cells');
  return cells instanceof Y.Map ? (cells as Y.Map<string>) : null;
}

const clip = (text: string) => text.slice(0, MAX_TABLE_CELL);

export function setTableCell(
  doc: Y.Doc,
  id: string,
  rowId: string,
  columnId: string,
  text: string,
  origin?: unknown,
): void {
  const t = parts(doc, id);
  if (!t) return;
  const row = t.rows.toArray().find((r) => r.get('id') === rowId);
  const cells = cellsOf(row);
  if (!cells) return;
  doc.transact(() => {
    if (text === '') cells.delete(columnId);
    else if (cells.get(columnId) !== text) cells.set(columnId, clip(text));
  }, origin);
}

/** Adds an empty row at `index` (the end when omitted). Null when the table is full. */
export function insertTableRow(
  doc: Y.Doc,
  id: string,
  index?: number,
  origin?: unknown,
): string | null {
  const t = parts(doc, id);
  if (!t || t.rows.length >= MAX_TABLE_ROWS) return null;
  const rowId = newElementId();
  doc.transact(() => {
    t.rows.insert(Math.min(index ?? t.rows.length, t.rows.length), [
      tableRowMap({ id: rowId, cells: {} }),
    ]);
  }, origin);
  return rowId;
}

/** Adds an empty column at `index` (the end when omitted). Null when the table is full. */
export function insertTableColumn(
  doc: Y.Doc,
  id: string,
  index?: number,
  origin?: unknown,
): string | null {
  const t = parts(doc, id);
  if (!t || t.columns.length >= MAX_TABLE_COLUMNS) return null;
  const columnId = newElementId();
  doc.transact(() => {
    t.columns.insert(Math.min(index ?? t.columns.length, t.columns.length), [
      new Y.Map<unknown>([['id', columnId]]),
    ]);
  }, origin);
  return columnId;
}

export function removeTableRow(doc: Y.Doc, id: string, rowId: string, origin?: unknown): void {
  const t = parts(doc, id);
  if (!t) return;
  const index = t.rows.toArray().findIndex((r) => r.get('id') === rowId);
  if (index >= 0) doc.transact(() => t.rows.delete(index, 1), origin);
}

/** Removes a column and its cells; the last column stays (a table has at least one). */
export function removeTableColumn(
  doc: Y.Doc,
  id: string,
  columnId: string,
  origin?: unknown,
): void {
  const t = parts(doc, id);
  if (!t || t.columns.length <= 1) return;
  const index = t.columns.toArray().findIndex((c) => c.get('id') === columnId);
  if (index < 0) return;
  doc.transact(() => {
    t.columns.delete(index, 1);
    for (const row of t.rows) cellsOf(row)?.delete(columnId);
  }, origin);
}

/** Moves the row at `from` to `to` (indexes of the current order). */
export function moveTableRow(doc: Y.Doc, id: string, from: number, to: number, origin?: unknown) {
  const t = parts(doc, id);
  if (!t) return;
  const copy = (row: Y.Map<unknown>) =>
    tableRowMap({ id: String(row.get('id')), cells: cellsOf(row)?.toJSON() ?? {} });
  moveItem(doc, t.rows, from, to, copy, origin);
}

/** Moves the column at `from` to `to`; cells are keyed by column id, so they follow. */
export function moveTableColumn(
  doc: Y.Doc,
  id: string,
  from: number,
  to: number,
  origin?: unknown,
) {
  const t = parts(doc, id);
  if (!t) return;
  moveItem(doc, t.columns, from, to, (col) => new Y.Map(Object.entries(col.toJSON())), origin);
}

function moveItem(
  doc: Y.Doc,
  list: Y.Array<Y.Map<unknown>>,
  from: number,
  to: number,
  copy: (item: Y.Map<unknown>) => Y.Map<unknown>,
  origin: unknown,
) {
  const item = list.get(from);
  if (!item || from === to || to < 0 || to >= list.length) return;
  doc.transact(() => {
    const fresh = copy(item);
    list.delete(from, 1);
    list.insert(to, [fresh]);
  }, origin);
}

/** Sets a column's width in world units; undefined lets it share the card's width again. */
export function setTableColumnWidth(
  doc: Y.Doc,
  id: string,
  columnId: string,
  width: number | undefined,
  origin?: unknown,
): void {
  const t = parts(doc, id);
  const col = t?.columns.toArray().find((c) => c.get('id') === columnId);
  if (!col) return;
  doc.transact(() => {
    if (width === undefined) col.delete('width');
    else col.set('width', Math.round(Math.min(1200, Math.max(40, width))));
  }, origin);
}

/**
 * Writes a grid of texts (pasted from a spreadsheet) with its top-left cell at `row`, `col`,
 * adding the rows and columns it needs up to the limits; what falls outside is dropped.
 * Returns the size that was written.
 */
export function fillTable(
  doc: Y.Doc,
  id: string,
  row: number,
  col: number,
  grid: readonly (readonly string[])[],
  origin?: unknown,
): { rows: number; columns: number } {
  const t = parts(doc, id);
  if (!t) return { rows: 0, columns: 0 };
  const width = Math.max(0, ...grid.map((r) => r.length));
  const columns = Math.min(width, MAX_TABLE_COLUMNS - col);
  const rows = Math.min(grid.length, MAX_TABLE_ROWS - row);
  if (columns <= 0 || rows <= 0) return { rows: 0, columns: 0 };
  doc.transact(() => {
    while (t.columns.length < col + columns)
      t.columns.push([new Y.Map<unknown>([['id', newElementId()]])]);
    while (t.rows.length < row + rows)
      t.rows.push([tableRowMap({ id: newElementId(), cells: {} })]);
    const columnIds = t.columns.toArray().map((c) => String(c.get('id')));
    for (let r = 0; r < rows; r++) {
      const cells = cellsOf(t.rows.get(row + r));
      if (!cells) continue;
      for (let c = 0; c < columns; c++) {
        const text = grid[r]?.[c] ?? '';
        const key = columnIds[col + c] as string;
        if (text === '') cells.delete(key);
        else cells.set(key, clip(text));
      }
    }
  }, origin);
  return { rows, columns };
}

/** The texts of a table, row by row, in column order. */
export function tableGrid(table: Pick<TableElement, 'columns' | 'rows'>): string[][] {
  return table.rows.map((r: TableRow) => table.columns.map((c) => r.cells[c.id] ?? ''));
}

/** A table as tab-separated values, as spreadsheets paste it; cells with tabs, quotes or line breaks are quoted. */
export function toTsv(grid: readonly (readonly string[])[]): string {
  const cell = (text: string) => (/[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  return grid.map((r) => r.map(cell).join('\t')).join('\n');
}

/**
 * Tab-separated values as Google Sheets, Excel and Numbers copy them: a cell with a line
 * break or a tab is quoted, with doubled quotes inside. A trailing line break ends the last
 * row instead of adding an empty one.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  let start = true;
  const src = text.replace(/\r\n?/g, '\n');
  while (i < src.length) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && start) {
      quoted = true;
      start = false;
      i++;
      continue;
    }
    start = false;
    if (ch === '\t') {
      row.push(cell);
      cell = '';
      start = true;
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      start = true;
    } else cell += ch;
    i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
