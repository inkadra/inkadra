// SPDX-License-Identifier: AGPL-3.0-only
// Moved to @inkadra/print (decision 0116); the web gives it its pictures in greys.
import { type PdfMeta, renderPdf as writePdf } from '@inkadra/print/pdf';
import { greyBytes, type LoadedImage } from './images.ts';
import type { FontWeight, Page } from './pages.ts';

export type { PdfImage, PdfMeta } from '@inkadra/print/pdf';

/** `@inkadra/print`'s `renderPdf` with the browser's greys (`greyBytes`). */
export function renderPdf(
  pages: readonly Page[],
  fonts: Record<FontWeight, Uint8Array>,
  images: ReadonlyMap<string, LoadedImage>,
  meta: PdfMeta,
  options: { signal?: AbortSignal; onPage?: (done: number) => void } = {},
): Promise<Uint8Array> {
  return writePdf(pages, fonts, images, meta, { grey: greyBytes, ...options });
}
