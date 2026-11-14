// SPDX-License-Identifier: AGPL-3.0-only
import { greyCanvas } from './images.ts';
import { imagePlacement, type Op, type Page, roundedRectPath } from './pages.ts';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type Image = { bitmap?: ImageBitmap; blob?: Blob; width: number; height: number };
type Images = ReadonlyMap<string, Image>;

/**
 * Draws a page on a 2D canvas at `scale` pixels per point, on its background, `offsetY` pixels down;
 * headings in `heading`, a CSS font stack.
 */
export function drawPage(
  ctx: Ctx,
  page: Page,
  scale: number,
  images: Images,
  offsetY = 0,
  heading = 'Inter',
) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, offsetY);
  if (page.background !== null) {
    ctx.fillStyle = page.background ?? '#FFFFFF';
    ctx.fillRect(0, 0, page.width, page.height);
  }
  // The PDF places glyphs by their advance only; the preview must break lines the same way.
  ctx.fontKerning = 'none';
  ctx.textBaseline = 'alphabetic';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawOps(ctx, page.ops, images, heading);
  ctx.restore();
}

function drawOps(ctx: Ctx, ops: readonly Op[], images: Images, heading: string) {
  for (const op of ops) {
    switch (op.kind) {
      case 'rect': {
        const path = new Path2D(roundedRectPath(op.x, op.y, op.w, op.h, op.radius));
        if (op.fill) {
          ctx.fillStyle = op.fill;
          ctx.fill(path);
        }
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.lineWidth ?? 1;
          ctx.setLineDash(op.dash ?? []);
          ctx.stroke(path);
          ctx.setLineDash([]);
        }
        break;
      }
      case 'line':
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.setLineDash(op.dash ?? []);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'text':
        ctx.font =
          op.weight === 'heading'
            ? `600 ${op.size}px ${heading}`
            : `${op.weight} ${op.size}px Inter`;
        ctx.fillStyle = op.color;
        ctx.fillText(op.text, op.x, op.y);
        break;
      case 'image': {
        const img = images.get(op.key);
        if (!img?.bitmap) break;
        const p = imagePlacement(img, op);
        ctx.globalAlpha = op.opacity ?? 1;
        const source = op.grey ? greyCanvas(img.bitmap, img.width, img.height) : img.bitmap;
        if (!p.transformed) {
          ctx.drawImage(source, p.cx - p.drawW / 2, p.cy - p.drawH / 2, p.drawW, p.drawH);
        } else {
          ctx.save();
          ctx.translate(p.cx, p.cy);
          if (p.rotation) ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.drawImage(source, -p.drawW / 2, -p.drawH / 2, p.drawW, p.drawH);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'polyline':
      case 'polygon': {
        ctx.beginPath();
        ctx.moveTo(op.points[0] ?? 0, op.points[1] ?? 0);
        for (let i = 2; i + 1 < op.points.length; i += 2) {
          ctx.lineTo(op.points[i] as number, op.points[i + 1] as number);
        }
        if (op.kind === 'polygon') {
          ctx.closePath();
          ctx.globalAlpha = op.opacity ?? 1;
          ctx.fillStyle = op.fill;
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = op.opacity ?? 1;
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.width;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.width;
        ctx.stroke();
        break;
      case 'clip':
        ctx.save();
        ctx.clip(new Path2D(roundedRectPath(op.x, op.y, op.w, op.h, op.radius)));
        drawOps(ctx, op.ops, images, heading);
        ctx.restore();
        break;
    }
  }
}

function pageKeys(ops: readonly Op[], into: Set<string>) {
  for (const op of ops) {
    if (op.kind === 'image') into.add(op.key);
    if (op.kind === 'clip') pageKeys(op.ops, into);
  }
}

/** The pictures of a page with their bitmaps decoded; `bitmaps` are the ones to close after. */
async function openPageImages(page: Page, images: Images) {
  const keys = new Set<string>();
  pageKeys(page.ops, keys);
  const bitmaps: ImageBitmap[] = [];
  let out: Map<string, Image> | null = null;
  for (const key of keys) {
    const img = images.get(key);
    if (!img?.blob || img.bitmap) continue;
    out ??= new Map(images);
    try {
      const bitmap = await createImageBitmap(img.blob);
      bitmaps.push(bitmap);
      out.set(key, { ...img, bitmap });
    } catch {
      // Drawn as missing, like a picture that failed to load.
    }
  }
  return { images: out ?? images, bitmaps };
}

/** One picture per page, drawn `scales[n]` pixels per point; canvases encode in sRGB. */
export async function renderImages(
  pages: readonly Page[],
  scales: readonly number[],
  images: Images,
  {
    signal,
    onPage,
    heading,
    format = 'png',
  }: {
    signal?: AbortSignal;
    onPage?: (done: number) => void;
    heading?: string;
    format?: 'png' | 'jpeg';
  } = {},
): Promise<Blob[]> {
  const blobs: Blob[] = [];
  for (const [n, page] of pages.entries()) {
    signal?.throwIfAborted();
    const scale = scales[n] ?? 1;
    // One canvas at a time: each page is encoded and released before the next is drawn.
    const canvas = new OffscreenCanvas(
      Math.round(page.width * scale),
      Math.round(page.height * scale),
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    // Pictures kept encoded are decoded for this page only and closed right after it.
    const opened = await openPageImages(page, images);
    try {
      drawPage(ctx, page, scale, opened.images, 0, heading);
    } finally {
      for (const b of opened.bitmaps) b.close();
    }
    blobs.push(
      await canvas.convertToBlob(
        format === 'jpeg' ? { type: 'image/jpeg', quality: 0.9 } : { type: 'image/png' },
      ),
    );
    onPage?.(n + 1);
    // Lets the dialog repaint its progress and a cancel through between pages.
    await new Promise((r) => setTimeout(r, 0));
  }
  signal?.throwIfAborted();
  return blobs;
}
