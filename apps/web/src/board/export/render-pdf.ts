// SPDX-License-Identifier: AGPL-3.0-only
import fontkit from '@pdf-lib/fontkit';
import {
  appendBezierCurve,
  clip,
  closePath,
  degrees,
  endPath,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
} from 'pdf-lib';
import type { LoadedImage } from './images.ts';
import { type FontWeight, imagePlacement, type Op, type Page, roundedRectPath } from './pages.ts';

export interface PdfMeta {
  title: string;
  author: string;
  subject: string;
  language: string;
}

function color(hex: string) {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Writes the pages as a PDF with Inter and the heading font embedded (subset) and the pictures
 * as JPEG or PNG.
 */
export async function renderPdf(
  pages: readonly Page[],
  fonts: Record<FontWeight, Uint8Array>,
  images: ReadonlyMap<string, LoadedImage>,
  meta: PdfMeta,
  { signal, onPage }: { signal?: AbortSignal; onPage?: (done: number) => void } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(meta.title, { showInWindowTitleBar: true });
  pdf.setAuthor(meta.author);
  pdf.setSubject(meta.subject);
  pdf.setLanguage(meta.language);
  pdf.setCreator('Inkadra');
  pdf.setProducer('Inkadra');
  const semibold = await pdf.embedFont(fonts[600], { subset: true });
  const embedded = {
    400: await pdf.embedFont(fonts[400], { subset: true }),
    500: await pdf.embedFont(fonts[500], { subset: true }),
    600: semibold,
    heading:
      fonts.heading === fonts[600]
        ? semibold
        : await pdf.embedFont(fonts.heading, { subset: true }),
  } satisfies Record<FontWeight, PDFFont>;
  const pictures = new Map<string, PDFImage>();
  const pictureOf = async (key: string) => {
    let img = pictures.get(key);
    if (img) return img;
    const source = images.get(key);
    if (!source?.bytes) return null;
    img =
      source.type === 'png' ? await pdf.embedPng(source.bytes) : await pdf.embedJpg(source.bytes);
    pictures.set(key, img);
    return img;
  };
  for (const [n, page] of pages.entries()) {
    signal?.throwIfAborted();
    const out = pdf.addPage([page.width, page.height]);
    // Round joins keep pen strokes smooth; every drawing inherits it.
    out.pushOperators(setLineJoin(LineJoinStyle.Round));
    await drawOps(out, page.height, page.ops, embedded, pictureOf);
    onPage?.(n + 1);
  }
  signal?.throwIfAborted();
  return pdf.save();
}

async function drawOps(
  page: PDFPage,
  height: number,
  ops: readonly Op[],
  fonts: Record<FontWeight, PDFFont>,
  pictureOf: (key: string) => Promise<PDFImage | null>,
) {
  // SVG paths are placed with their origin at the top left of the page, y going down.
  const svg = { x: 0, y: height };
  for (const op of ops) {
    switch (op.kind) {
      case 'rect': {
        page.drawSvgPath(roundedRectPath(op.x, op.y, op.w, op.h, op.radius), {
          ...svg,
          ...(op.fill ? { color: color(op.fill) } : {}),
          ...(op.stroke ? { borderColor: color(op.stroke), borderWidth: op.lineWidth ?? 1 } : {}),
          ...(op.dash ? { borderDashArray: op.dash } : {}),
        });
        break;
      }
      case 'line':
        page.drawLine({
          start: { x: op.x1, y: height - op.y1 },
          end: { x: op.x2, y: height - op.y2 },
          color: color(op.color),
          thickness: op.width,
          ...(op.dash ? { dashArray: op.dash } : {}),
        });
        break;
      case 'text':
        if (!op.text) break;
        page.drawText(op.text, {
          x: op.x,
          y: height - op.y,
          size: op.size,
          font: fonts[op.weight],
          color: color(op.color),
        });
        break;
      case 'image': {
        const img = await pictureOf(op.key);
        if (!img) break;
        const p = imagePlacement(img, op);
        if (!p.transformed || p.rotation === 0) {
          page.drawImage(img, {
            x: p.cx - p.drawW / 2,
            y: height - p.cy - p.drawH / 2,
            width: p.drawW,
            height: p.drawH,
            ...(op.opacity !== undefined && op.opacity < 1 ? { opacity: op.opacity } : {}),
          });
        } else {
          const theta = (-p.rotation * Math.PI) / 180;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const dx = (p.drawW / 2) * cos - (p.drawH / 2) * sin;
          const dy = (p.drawW / 2) * sin + (p.drawH / 2) * cos;
          page.drawImage(img, {
            x: p.cx - dx,
            y: height - p.cy - dy,
            width: p.drawW,
            height: p.drawH,
            rotate: degrees(-p.rotation),
            ...(op.opacity !== undefined && op.opacity < 1 ? { opacity: op.opacity } : {}),
          });
        }
        break;
      }
      case 'polyline': {
        if (op.points.length < 4) break;
        let d = `M${op.points[0]} ${op.points[1]}`;
        for (let i = 2; i + 1 < op.points.length; i += 2)
          d += `L${op.points[i]} ${op.points[i + 1]}`;
        page.drawSvgPath(d, {
          ...svg,
          borderColor: color(op.color),
          borderWidth: op.width,
          borderLineCap: LineCapStyle.Round,
          ...(op.opacity !== undefined && op.opacity < 1 ? { borderOpacity: op.opacity } : {}),
        });
        break;
      }
      case 'polygon': {
        let d = `M${op.points[0]} ${op.points[1]}`;
        for (let i = 2; i + 1 < op.points.length; i += 2)
          d += `L${op.points[i]} ${op.points[i + 1]}`;
        page.drawSvgPath(`${d}Z`, { ...svg, color: color(op.fill) });
        break;
      }
      case 'ellipse':
        page.drawEllipse({
          x: op.cx,
          y: height - op.cy,
          xScale: op.rx,
          yScale: op.ry,
          borderColor: color(op.stroke),
          borderWidth: op.width,
        });
        break;
      case 'clip': {
        page.pushOperators(pushGraphicsState(), ...clipPath(op, height), clip(), endPath());
        await drawOps(page, height, op.ops, fonts, pictureOf);
        page.pushOperators(popGraphicsState());
        break;
      }
    }
  }
}

/** Path operators of a (rounded) box in PDF coordinates, y going up. */
function clipPath(
  box: { x: number; y: number; w: number; h: number; radius?: number },
  height: number,
) {
  const r = Math.max(0, Math.min(box.radius ?? 0, box.w / 2, box.h / 2));
  const k = r * 0.5523;
  const left = box.x;
  const right = box.x + box.w;
  const top = height - box.y;
  const bottom = height - box.y - box.h;
  return [
    moveTo(left + r, top),
    lineTo(right - r, top),
    appendBezierCurve(right - r + k, top, right, top - r + k, right, top - r),
    lineTo(right, bottom + r),
    appendBezierCurve(right, bottom + r - k, right - r + k, bottom, right - r, bottom),
    lineTo(left + r, bottom),
    appendBezierCurve(left + r - k, bottom, left, bottom + r - k, left, bottom + r),
    lineTo(left, top - r),
    appendBezierCurve(left, top - r + k, left + r - k, top, left + r, top),
    closePath(),
  ];
}
