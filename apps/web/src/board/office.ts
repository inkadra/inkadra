// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, newTable } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { type BoardStore, LOCAL } from './store.ts';

export type { OfficePreview, OfficeSheet } from '@inkadra/shared';

import { OfficePreview, type OfficeSheet } from '@inkadra/shared';
export const isOffice = (name: string) => /\.(docx|xlsx|pptx|odt|ods|odp|csv)$/i.test(name);
/**
 * A derivative of an Office asset. Pages carry the `revision` of the manifest: they never
 * change under one URL, so the server lets the browser keep them for a year.
 */
export const officeUrl = (id: string, part = 'manifest.json', revision?: string) =>
  `/api/v1/assets/${id}/office/${part}${revision ? `?v=${encodeURIComponent(revision)}` : ''}`;

/** What a sheet keeps (the API contract's limits): the viewer says when more was left out. */
export const SHEET_PREVIEW = { rows: 500, columns: 20 };
/** Cells that read as numbers (also `12,5` and `25%`) are right-aligned, as in a spreadsheet. */
export const isNumeric = (cell: string) => /^[+-]?(\d+([.,]\d+)?|[.,]\d+)%?$/.test(cell);

/** A sheet that can become a table card: it has cells and nothing was left out. */
export const tableable = (sheet: OfficeSheet | undefined): sheet is OfficeSheet =>
  !!sheet && sheet.rows.length > 0 && !sheet.truncated;

/** Always the first sheet, independently of the selected viewer tab. */
export function officeTable(
  store: BoardStore,
  source: Element,
  sheets: OfficeSheet[],
  userId: string,
): string | null {
  if (!OfficePreview.safeParse({ pageCount: 0, sheets }).success) return null;
  const first = sheets[0];
  // A sheet with rows left out would put a partial budget on the board.
  if (!tableable(first)) return null;
  const width = Math.max(1, ...first.rows.map((r) => r.length));
  const data = newTable(width, first.rows.length);
  data.rows.forEach((row, r) => {
    data.columns.forEach((column, c) => {
      row.cells[column.id] = first.rows[r]?.[c] ?? '';
    });
  });
  store.undo.stopCapturing();
  const card = createElement(
    store.doc,
    'table',
    { x: source.x + source.w + 24, y: source.y },
    { ...data, w: Math.max(360, width * 120), header: true },
    { userId, origin: LOCAL },
  );
  store.undo.stopCapturing();
  return card.id;
}
