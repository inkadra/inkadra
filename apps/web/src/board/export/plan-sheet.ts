// SPDX-License-Identifier: AGPL-3.0-only
/** The room's size the sheet prints lives in canvas-core (decision 0116). */
export { roomSize } from '@inkadra/canvas-core';
// The sheet's layout moved to @inkadra/print (decision 0116); the dialog's preview stays here.
export type { PlanSheetInclude, PlanSheetInput, PlanSheetSetup } from '@inkadra/print';
export {
  PLAN_SHEET_FRAME,
  PLAN_SHEET_INCLUDE,
  planSheetPages,
  sheetInclude,
} from '@inkadra/print';

/**
 * How the export dialog previews a sheet: the page drawn at `scale` (device pixels per point) on
 * a canvas of `page` pixels, then the part under `frame` copied from `from` into a canvas of
 * `size` pixels, so the drawing fills a preview `cssWidth` wide, sharp at `dpr`.
 */
export function previewCrop(
  page: { width: number; height: number },
  frame: { x: number; y: number; w: number; h: number },
  cssWidth: number,
  dpr: number,
): {
  scale: number;
  page: { w: number; h: number };
  from: { x: number; y: number };
  size: { w: number; h: number };
} {
  // A preview not laid out yet has no width: the dialog's column, 232 px.
  const scale = ((cssWidth > 0 ? cssWidth : 232) / frame.w) * (dpr > 0 ? dpr : 1);
  const px = (v: number) => Math.round(v * scale);
  return {
    scale,
    page: { w: px(page.width), h: px(page.height) },
    from: { x: frame.x * scale, y: frame.y * scale },
    size: { w: px(frame.w), h: px(frame.h) },
  };
}
