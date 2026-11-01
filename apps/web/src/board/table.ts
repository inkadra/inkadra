// SPDX-License-Identifier: AGPL-3.0-only
import {
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  parseTsv,
  removeTableColumn,
  removeTableRow,
  updateElement,
} from '@inkadra/canvas-core';
import { type Element, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from '@inkadra/doc-schema';
import type { TFunction } from 'i18next';
import type * as Y from 'yjs';
import type { MenuItem } from './chrome.tsx';
import { LOCAL } from './store.ts';

/** What a link in a table cell shows: its host, without `www.`. */
export function linkLabel(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/**
 * The rows of the first table in clipboard HTML (Excel, Numbers and Google Sheets put one
 * there besides the TSV). Parsed inert by DOMParser: nothing in it runs or loads.
 */
export function htmlTableGrid(html: string): string[][] | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (!table) return null;
  const grid = [...table.rows]
    .slice(0, MAX_TABLE_ROWS)
    .map((tr) =>
      [...tr.cells].slice(0, MAX_TABLE_COLUMNS).map((td) => (td.textContent ?? '').trim()),
    );
  return grid.length > 0 ? grid : null;
}

/**
 * A spreadsheet range on the clipboard, or null when the text is not one: at least two
 * cells, from the TSV, or else from an HTML table.
 */
export function clipboardGrid(text: string, html: string): string[][] | null {
  const plain = text.replace(/\r?\n$/, '');
  if (plain.includes('\t')) return parseTsv(plain);
  const grid = htmlTableGrid(html);
  return grid && (grid.length > 1 || (grid[0]?.length ?? 0) > 1) ? grid : null;
}

/**
 * The table's entries of the card menu: the header row, and for the cell the menu was opened
 * on, rows and columns to insert, move and delete.
 */
export function tableMenu(
  doc: Y.Doc,
  table: Extract<Element, { type: 'table' }>,
  cell: { r: number; c: number } | undefined,
  t: TFunction,
): MenuItem[] {
  const id = table.id;
  const items: MenuItem[] = [
    {
      label: t(table.header ? 'board.table.headerOff' : 'board.table.headerOn'),
      action: () => updateElement(doc, id, { header: table.header ? undefined : true }, LOCAL),
    },
  ];
  const row = cell && table.rows[cell.r];
  const col = cell && table.columns[cell.c];
  if (!cell || !row || !col) return items;
  const { r, c } = cell;
  const rows = table.rows.length;
  const cols = table.columns.length;
  items.push(
    { divider: true },
    { label: t('board.table.rowAbove'), action: () => insertTableRow(doc, id, r, LOCAL) },
    { label: t('board.table.rowBelow'), action: () => insertTableRow(doc, id, r + 1, LOCAL) },
    { label: t('board.table.columnLeft'), action: () => insertTableColumn(doc, id, c, LOCAL) },
    {
      label: t('board.table.columnRight'),
      action: () => insertTableColumn(doc, id, c + 1, LOCAL),
    },
    { divider: true },
    ...(r > 0
      ? [{ label: t('board.table.rowUp'), action: () => moveTableRow(doc, id, r, r - 1, LOCAL) }]
      : []),
    ...(r < rows - 1
      ? [
          {
            label: t('board.table.rowDown'),
            action: () => moveTableRow(doc, id, r, r + 1, LOCAL),
          },
        ]
      : []),
    ...(c > 0
      ? [
          {
            label: t('board.table.columnLeftMove'),
            action: () => moveTableColumn(doc, id, c, c - 1, LOCAL),
          },
        ]
      : []),
    ...(c < cols - 1
      ? [
          {
            label: t('board.table.columnRightMove'),
            action: () => moveTableColumn(doc, id, c, c + 1, LOCAL),
          },
        ]
      : []),
    { divider: true },
    {
      label: t('board.table.deleteRow'),
      danger: true,
      action: () => removeTableRow(doc, id, row.id, LOCAL),
    },
    ...(cols > 1
      ? [
          {
            label: t('board.table.deleteColumn'),
            danger: true,
            action: () => removeTableColumn(doc, id, col.id, LOCAL),
          },
        ]
      : []),
  );
  return items;
}
