// SPDX-License-Identifier: AGPL-3.0-only
import { fitBox, type Op, type Page, roundedRectPath } from './pages.ts';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type Images = ReadonlyMap<string, { bitmap: ImageBitmap; width: number; height: number }>;

/** Draws a page on a 2D canvas at `scale` pixels per point, on white paper, `offsetY` pixels down. */
export function drawPage(ctx: Ctx, page: Page, scale: number, images: Images, offsetY = 0) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, offsetY);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, page.width, page.height);
  // The PDF places glyphs by their advance only; the preview must break lines the same way.
  ctx.fontKerning = 'none';
  ctx.textBaseline = 'alphabetic';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawOps(ctx, page.ops, images);
  ctx.restore();
}

function drawOps(ctx: Ctx, ops: readonly Op[], images: Images) {
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
        ctx.font = `${op.weight} ${op.size}px Inter`;
        ctx.fillStyle = op.color;
        ctx.fillText(op.text, op.x, op.y);
        break;
      case 'image': {
        const img = images.get(op.key);
        if (!img) break;
        const box = fitBox(img, op, op.fit);
        ctx.globalAlpha = op.opacity ?? 1;
        ctx.drawImage(img.bitmap, box.x, box.y, box.w, box.h);
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
          ctx.fillStyle = op.fill;
          ctx.fill();
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
        drawOps(ctx, op.ops, images);
        ctx.restore();
        break;
    }
  }
}

/** Pages stacked into one PNG, `scale` pixels per point, `background` between pages. */
export async function renderPng(
  pages: readonly Page[],
  scale: number,
  images: Images,
  background: string,
): Promise<Blob> {
  const gap = pages.length > 1 ? 24 : 0;
  const width = Math.max(...pages.map((p) => p.width));
  const height = pages.reduce((sum, p) => sum + p.height, 0) + gap * (pages.length - 1);
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (const page of pages) {
    drawPage(ctx, page, scale, images, Math.round(y * scale));
    y += page.height + gap;
  }
  return canvas.convertToBlob({ type: 'image/png' });
}
