// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, newTable } from '@inkadra/canvas-core';
import type { Element } from '@inkadra/doc-schema';
import { type BoardStore, LOCAL } from './store.ts';

export type { OfficePreview, OfficeSheet } from '@inkadra/shared';

import { OfficePreview, type OfficeSheet } from '@inkadra/shared';
export const isOffice = (name: string) => /\.(docx|xlsx|pptx|odt|ods|odp|csv)$/i.test(name);
export const officeUrl = (id: string, part = 'manifest.json') =>
  `/api/v1/assets/${id}/office/${part}`;

/** Always the first sheet, independently of the selected viewer tab. */
export function officeTable(
  store: BoardStore,
  source: Element,
  sheets: OfficeSheet[],
  userId: string,
): string | null {
  if (!OfficePreview.safeParse({ pageCount: 0, sheets }).success) return null;
  const first = sheets[0];
  if (!first?.rows.length) return null;
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
