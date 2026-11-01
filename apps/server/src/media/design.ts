// SPDX-License-Identifier: AGPL-3.0-only
import { extname } from 'node:path';
import { readZip } from '../transfers/zip.ts';
import { runTool } from './tools.ts';

export const DESIGN_EXTENSIONS = ['psd', 'psb', 'procreate', 'sketch', 'afdesign', 'afphoto', 'ai'];
export const designExtension = (filename: string) => {
  const ext = extname(filename).slice(1).toLowerCase();
  return DESIGN_EXTENSIONS.includes(ext) ? ext : null;
};

export const DESIGN_PREVIEW_BYTES = 64 * 1024 ** 2;
const PREVIEWS: Record<string, string[]> = {
  procreate: ['QuickLook/Thumbnail.png', 'QuickLook/Preview.png'],
  sketch: ['previews/preview.png', 'preview.png'],
  afdesign: ['previews/preview.png', 'QuickLook/Thumbnail.png', 'preview.png'],
  afphoto: ['previews/preview.png', 'QuickLook/Thumbnail.png', 'preview.png'],
};

/** Names are looked up, never extracted to disk; only one bounded entry is inflated. */
export async function archiveDesignPreview(file: string, ext: string): Promise<Buffer | null> {
  const zip = await readZip(file, {
    entries: 10_000,
    totalBytes: 2 * 1024 ** 3,
    compressionRatio: 200,
  });
  try {
    const name = PREVIEWS[ext]?.find((name) => zip.has(name));
    return name ? await zip.buffer(name, DESIGN_PREVIEW_BYTES) : null;
  } finally {
    zip.close();
  }
}

/** Photoshop thumbnails only: no layer rendering or arbitrary output paths. */
export async function photoshopPreview(exiftool: string, file: string): Promise<Buffer | null> {
  return runTool(exiftool, ['-b', '-PhotoshopThumbnail', file], {
    timeoutMs: 30_000,
    memoryBytes: 2 * 1024 ** 3,
    fileBytes: DESIGN_PREVIEW_BYTES,
    maxBuffer: DESIGN_PREVIEW_BYTES,
    nice: true,
  })
    .then((data) => (data.length ? data : null))
    .catch(() => null);
}
