// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shape of an exported picture (decision 0072): pages or cards fitted or cropped into a social
 * format. Not a page format: `slide` is a page of the PDF, the 16:9 here is 1920 × 1080 pixels.
 */
import type { ExportImageAspect, ExportImageFit } from '@inkadra/shared';
import { transformOps } from './board-render.ts';
import { pngScales } from './layout.ts';
import type { Op, Page } from './pages.ts';

export const IMAGE_ASPECTS: readonly ExportImageAspect[] = [
  'original',
  '4:5',
  '1:1',
  '9:16',
  '16:9',
];

/** 1080 pixels on the short side. */
export const ASPECT_PIXELS: Record<
  Exclude<ExportImageAspect, 'original'>,
  { width: number; height: number }
> = {
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};

/** Where the crop sits, from 0 to 1 on each axis: 0 keeps the left or top edge. */
export interface Focus {
  x: number;
  y: number;
}
export const CENTRE: Focus = { x: 0.5, y: 0.5 };

export interface ImageOptions {
  aspect: ExportImageAspect;
  fit: ExportImageFit;
  /** Several cards: one picture of them all, or one each. Null: what the aspect suggests. */
  many: 'one' | 'each' | null;
  /** By image, while the dialog is open; never saved. */
  foci: Readonly<Record<number, Focus>>;
}

export const ORIGINAL_IMAGE: ImageOptions = {
  aspect: 'original',
  fit: 'fill',
  many: null,
  foci: {},
};

/** A social format makes a carousel, one image per card; "Original" keeps today's single picture. */
export function manyMode(image: Pick<ImageOptions, 'aspect' | 'many'>): 'one' | 'each' {
  return image.many ?? (image.aspect === 'original' ? 'one' : 'each');
}

export function clampFocus({ x, y }: Focus): Focus {
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

const ARROWS: Record<string, Focus> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** The focus point after an arrow key (Shift for 10%); null for any other key. */
export function focusAfterKey(focus: Focus, key: string, shift: boolean): Focus | null {
  const arrow = ARROWS[key];
  if (!arrow) return null;
  const step = shift ? 0.1 : 0.02;
  return clampFocus({ x: focus.x + arrow.x * step, y: focus.y + arrow.y * step });
}

/**
 * Where content lands in a box: `fit` shows all of it, centred; `fill` covers the box and the
 * focus point chooses which part is cut.
 */
export function placeContent(
  content: { width: number; height: number },
  box: { width: number; height: number },
  fit: ExportImageFit,
  focus: Focus = CENTRE,
) {
  const ratios = [box.width / content.width, box.height / content.height];
  const scale = fit === 'fill' ? Math.max(...ratios) : Math.min(...ratios);
  const width = content.width * scale;
  const height = content.height * scale;
  const at = fit === 'fill' ? clampFocus(focus) : CENTRE;
  return {
    scale,
    x: (box.width - width) * at.x,
    y: (box.height - height) * at.y,
    width,
    height,
  };
}

/** The exported picture inside the preview's stage, clear of the label above it. */
export function frameInStage(stage: { width: number; height: number }, ratio: number) {
  const PAD = 24;
  const LABEL = 16;
  let width = stage.width - PAD * 2;
  let height = width / ratio;
  const room = stage.height - PAD * 2 - LABEL;
  if (height > room) {
    height = room;
    width = height * ratio;
  }
  return {
    width,
    height,
    left: (stage.width - width) / 2,
    top: (stage.height - height) / 2 + 6,
  };
}

/** `content` in a social format, one point to one pixel, on `colour` where it does not reach. */
export function formatPage(
  content: Page,
  aspect: Exclude<ExportImageAspect, 'original'>,
  fit: ExportImageFit,
  focus: Focus | undefined,
  colour: string,
): Page {
  const box = ASPECT_PIXELS[aspect];
  const at = placeContent(content, box, fit, focus);
  // A page of the document keeps its white paper under its text.
  const paper: Op[] =
    content.background === undefined
      ? [{ kind: 'rect', x: at.x, y: at.y, w: at.width, h: at.height, fill: '#FFFFFF' }]
      : [];
  return {
    ...box,
    background: fit === 'fill' && content.background !== undefined ? content.background : colour,
    ops: [
      {
        kind: 'clip',
        x: 0,
        y: 0,
        w: box.width,
        h: box.height,
        ops: [...paper, ...transformOps(content.ops, at.scale, at.x, at.y)],
      },
    ],
  };
}

/** The pictures to encode, with the pixels per point of each. */
export function imagePages(contents: readonly Page[], image: ImageOptions, colour: string) {
  const { aspect, fit, foci } = image;
  if (aspect === 'original') {
    const { scales, reduced } = pngScales(contents);
    return {
      pages: contents,
      // Pictures stop at the thumbnail's own pixels: enlarging them adds none.
      scales: scales.map((s, i) => Math.min(s, contents[i]?.maxScale ?? s)),
      reduced,
    };
  }
  return {
    pages: contents.map((page, i) => formatPage(page, aspect, fit, foci[i], colour)),
    scales: contents.map(() => 1),
    reduced: false,
  };
}

/** Names of the files of an export: a lone file has none of the numbers (#397). */
export function imageNames(base: string, count: number, format: 'png' | 'jpeg'): string[] {
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  if (count === 1) return [`${base}.${ext}`];
  return Array.from(
    { length: count },
    (_, n) => `${base}-${String(n + 1).padStart(3, '0')}.${ext}`,
  );
}
