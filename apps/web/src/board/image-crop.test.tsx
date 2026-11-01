// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { initBoardDoc } from '@inkadra/doc-schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CroppedImage } from './CroppedImage.tsx';
import { type CardContext, cardHeight, drawCard, type Palette } from './export/board-render.ts';
import { imagePlacement, type Op } from './export/pages.ts';
import { applyImageTransform, restoreOriginalImage } from './ImageCropEditor.tsx';
import {
  conformCropAspect,
  cropAfterQuarterTurn,
  cropInsideImage,
  croppedRotatedSize,
  FULL_CROP,
  fitCropToAspect,
  hasImageTransform,
  inscribeCrop,
  isIdentityCrop,
  moveCropRect,
  normalizeRotation,
  resizeCropRect,
  rotateCrop90,
  rotatedBounds,
  sanitizeCrop,
  splitRotation,
} from './image-crop.ts';
import { BoardStore } from './store.ts';

describe('image-crop geometry helpers', () => {
  it('normalizes rotation into (-180, 180] and splits into 90° base + fine angle', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(270)).toBe(-90);
    expect(normalizeRotation(-270)).toBe(90);

    expect(splitRotation(0)).toEqual({ base: 0, fine: 0 });
    expect(splitRotation(95)).toEqual({ base: 90, fine: 5 });
    expect(splitRotation(-85)).toEqual({ base: 270, fine: 5 });
  });

  it('sanitizes crop bounds and detects identity / transformed states', () => {
    expect(isIdentityCrop(undefined)).toBe(true);
    expect(isIdentityCrop(FULL_CROP)).toBe(true);
    expect(isIdentityCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })).toBe(false);

    const clamped = sanitizeCrop({ x: -0.2, y: 0.8, w: 2, h: 0.5, aspect: '16:9' });
    expect(clamped.x).toBe(0);
    expect(clamped.w).toBe(1);
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(1);
    expect(clamped.aspect).toBe('16:9');

    expect(hasImageTransform({ crop: undefined, rotation: undefined })).toBe(false);
    expect(hasImageTransform({ crop: FULL_CROP, rotation: 0 })).toBe(false);
    expect(hasImageTransform({ crop: { x: 0.1, y: 0, w: 0.8, h: 1 }, rotation: 0 })).toBe(true);
    expect(hasImageTransform({ crop: undefined, rotation: 90 })).toBe(true);
  });

  it('computes rotated bounding box and cropped dimensions accurately', () => {
    const r0 = rotatedBounds(1600, 900, 0);
    expect(r0.width).toBeCloseTo(1600, 3);
    expect(r0.height).toBeCloseTo(900, 3);

    const r90 = rotatedBounds(1600, 900, 90);
    expect(r90.width).toBeCloseTo(900, 3);
    expect(r90.height).toBeCloseTo(1600, 3);

    const cropped = croppedRotatedSize(1600, 900, { x: 0.25, y: 0, w: 0.5, h: 1 }, 0);
    expect(cropped.width).toBeCloseTo(800, 3);
    expect(cropped.height).toBeCloseTo(900, 3);
  });

  it('fits crop rectangle to aspect ratio presets around its center', () => {
    const square = fitCropToAspect(FULL_CROP, '1:1', 1600, 900);
    expect(square.aspect).toBe('1:1');
    const pixelW = square.w * 1600;
    const pixelH = square.h * 900;
    expect(pixelW / pixelH).toBeCloseTo(1, 3);
    expect(square.x + square.w / 2).toBeCloseTo(0.5, 3);
    expect(square.y + square.h / 2).toBeCloseTo(0.5, 3);

    const scope = fitCropToAspect(FULL_CROP, '2.39:1', 1600, 900);
    expect((scope.w * 1600) / (scope.h * 900)).toBeCloseTo(2.39, 2);
  });

  it('rotates crop rectangle across 90° clockwise and counter-clockwise steps', () => {
    const initial = { x: 0.1, y: 0.2, w: 0.5, h: 0.3, aspect: '16:9' as const };
    const cw = rotateCrop90(initial, 1);
    expect(cw.x).toBeCloseTo(0.5, 5);
    expect(cw.y).toBeCloseTo(0.1, 5);
    expect(cw.w).toBeCloseTo(0.3, 5);
    expect(cw.h).toBeCloseTo(0.5, 5);

    const back = rotateCrop90(cw, -1);
    expect(back.x).toBeCloseTo(initial.x, 5);
    expect(back.y).toBeCloseTo(initial.y, 5);
    expect(back.w).toBeCloseTo(initial.w, 5);
    expect(back.h).toBeCloseTo(initial.h, 5);
  });

  it('keeps a preset crop at its aspect across 90° steps and fine angles', () => {
    // A 480×320 picture cropped to 16:9, then turned clockwise: the result stays 16:9.
    const crop = fitCropToAspect(FULL_CROP, '16:9', 480, 320);
    const turned = rotatedBounds(480, 320, 90);
    const next = cropAfterQuarterTurn(crop, 1, turned.width, turned.height);
    const out = croppedRotatedSize(480, 320, next, 90);
    expect(out.width / out.height).toBeCloseTo(16 / 9, 3);
    expect(next.aspect).toBe('16:9');

    const tilted = rotatedBounds(480, 320, 12);
    const kept = conformCropAspect(crop, tilted.width, tilted.height);
    const tiltedOut = croppedRotatedSize(480, 320, kept, 12);
    expect(tiltedOut.width / tiltedOut.height).toBeCloseTo(16 / 9, 3);

    // A free crop turns with the picture.
    const free = { x: 0.1, y: 0.2, w: 0.5, h: 0.3 };
    expect(cropAfterQuarterTurn(free, 1, 320, 480)).toEqual(rotateCrop90(free, 1));
  });

  it('shrinks a crop off the empty corners of a free angle onto the picture', () => {
    expect(cropInsideImage(FULL_CROP, 480, 320, 0)).toBe(true);
    expect(cropInsideImage(FULL_CROP, 480, 320, 90)).toBe(true);
    expect(cropInsideImage(FULL_CROP, 480, 320, 10)).toBe(false);
    const preset = fitCropToAspect(FULL_CROP, '16:9', 480, 320);
    const inscribed = inscribeCrop(preset, 480, 320, 10);
    expect(cropInsideImage(inscribed, 480, 320, 10)).toBe(true);
    const out = croppedRotatedSize(480, 320, inscribed, 10);
    expect(out.width / out.height).toBeCloseTo(16 / 9, 2);
    // Largest: a slightly bigger crop of the same aspect would leave the picture.
    const grown = {
      ...inscribed,
      x: inscribed.x - 0.01,
      y: inscribed.y - 0.01,
      w: inscribed.w + 0.02,
      h: inscribed.h + 0.02,
    };
    expect(cropInsideImage(grown, 480, 320, 10)).toBe(false);
    // Crops already on the picture stay as they are.
    const small = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    expect(inscribeCrop(small, 480, 320, 10)).toBe(small);
  });

  it('keeps tiny imported crops that the schema accepts', () => {
    const tiny = sanitizeCrop({ x: 0.5, y: 0.5, w: 0.001, h: 0.002 });
    expect(tiny.w).toBeCloseTo(0.001, 4);
    expect(tiny.h).toBeCloseTo(0.002, 4);
  });

  it('places the PDF and PNG picture for 90° and 45° rotations', () => {
    const info = { width: 400, height: 200 };
    // 90°: the turned picture is 200×400; it fills a 100×200 box exactly, centered.
    const quarter = imagePlacement(info, {
      x: 0,
      y: 0,
      w: 100,
      h: 200,
      fit: 'cover',
      rotation: 90,
    });
    expect(quarter).toMatchObject({ transformed: true, rotation: 90 });
    expect(quarter.cx).toBeCloseTo(50, 5);
    expect(quarter.cy).toBeCloseTo(100, 5);
    expect(quarter.drawW).toBeCloseTo(200, 5);
    expect(quarter.drawH).toBeCloseTo(100, 5);
    // 45°: bounds are (400+200)/√2 square; the picture keeps its own proportions.
    const box = { x: 10, y: 20, w: 300, h: 300, fit: 'contain' as const, rotation: 45 };
    const tilted = imagePlacement(info, box);
    const side = 600 / Math.SQRT2;
    expect(tilted.rotation).toBe(45);
    expect(tilted.cx).toBeCloseTo(160, 5);
    expect(tilted.cy).toBeCloseTo(170, 5);
    expect(tilted.drawW).toBeCloseTo((400 * 300) / side, 5);
    expect(tilted.drawH).toBeCloseTo((200 * 300) / side, 5);
    expect(tilted.drawW / tilted.drawH).toBeCloseTo(2, 5);
  });

  it('moves and resizes crop rectangle within [0, 1] bounds', () => {
    const start = { x: 0.2, y: 0.2, w: 0.5, h: 0.5, aspect: 'free' as const };
    const moved = moveCropRect(start, 0.5, -0.5);
    expect(moved.x).toBeCloseTo(0.5, 5);
    expect(moved.y).toBeCloseTo(0, 5);

    const resized = resizeCropRect(start, 'se', 0.2, 0.1, 1000, 1000);
    expect(resized.w).toBeCloseTo(0.7, 5);
    expect(resized.h).toBeCloseTo(0.6, 5);

    const lockedStart = fitCropToAspect(FULL_CROP, '1:1', 1000, 1000);
    const lockedResized = resizeCropRect(lockedStart, 'se', -0.3, -0.1, 1000, 1000);
    expect(lockedResized.w).toBeCloseTo(lockedResized.h, 3);
  });
});

describe('CroppedImage component & BoardStore integration', () => {
  it('renders plain picture when untransformed and cropped container when transformed', () => {
    const plainHtml = renderToStaticMarkup(
      <CroppedImage poster="/img.jpg" alt="Plain" width={800} height={600} />,
    );
    expect(plainHtml).not.toContain('cropped-image');

    const croppedHtml = renderToStaticMarkup(
      <CroppedImage
        poster="/img.jpg"
        alt="Cropped"
        width={800}
        height={600}
        crop={{ x: 0.1, y: 0.1, w: 0.5, h: 0.5, aspect: '1:1' }}
        rotation={90}
      />,
    );
    expect(croppedHtml).toContain('cropped-image');
    expect(croppedHtml).toContain('data-cropped="true"');
    expect(croppedHtml).toContain('rotate(90deg)');
  });

  it('persists and restores image crop and rotation in BoardStore and updates estimated height', () => {
    const doc = new Y.Doc();
    initBoardDoc(doc, 'board-1');
    const store = new BoardStore(doc);
    const img = createElement(
      doc,
      'image',
      { x: 100, y: 100 },
      { w: 300, assetId: 'asset-1' },
      { userId: 'u1' },
    );
    if (img.type !== 'image') throw new Error('expected image element');

    const initialH = store.rectOf(img).h;
    applyImageTransform(store, img, { x: 0, y: 0.25, w: 1, h: 0.5, aspect: '16:9' }, 90);

    const updated = store.getSnapshot().byId.get(img.id);
    expect(updated?.type).toBe('image');
    if (updated?.type === 'image') {
      expect(updated.rotation).toBe(90);
      expect(updated.crop).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5, aspect: '16:9' });
      expect(store.rectOf(updated).h).not.toBe(initialH);

      restoreOriginalImage(store, updated);
    }

    const restored = store.getSnapshot().byId.get(img.id);
    expect(restored?.type).toBe('image');
    if (restored?.type === 'image') {
      expect(restored.crop).toBeUndefined();
      expect(restored.rotation).toBeUndefined();
      expect(store.rectOf(restored).h).toBe(initialH);
    }
  });

  it('propagates crop and rotation to export operations and computes placement', () => {
    const doc = new Y.Doc();
    initBoardDoc(doc, 'board-1');
    const img = createElement(
      doc,
      'image',
      { x: 40, y: 50 },
      {
        w: 240,
        assetId: 'asset-exp',
        crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.5, aspect: '1:1' },
        rotation: 90,
      },
      { userId: 'u1' },
    );
    const colors = {
      'surface-1': '#fff',
      'surface-2': '#f5f5f5',
      'surface-3': '#eee',
      'border-default': '#ddd',
      'border-strong': '#ccc',
      'text-primary': '#111',
      'text-secondary': '#555',
      'text-muted': '#888',
      'bg-canvas': '#fafafa',
      'tag-blue': '#00f',
      'tag-orange': '#f80',
      'tag-purple': '#80f',
      'tag-green': '#0a0',
      'tag-blue-bg': '#eef',
      'tag-orange-bg': '#fee',
      'tag-purple-bg': '#fef',
      'tag-green-bg': '#efe',
      'tag-yellow': '#880',
      'tag-red': '#a00',
    } satisfies Palette;
    const ctx: CardContext = {
      measure: (text, size) => text.length * size * 0.5,
      colors,
      noteBlocks: () => [],
      image: () => ({ key: 'asset-exp', info: { width: 1200, height: 800 } }),
      fileName: () => 'file.png',
      boardTitle: () => 'Board',
      frameLabel: () => '1A',
      frameAspect: () => 16 / 9,
      frameMeta: () => '',
      slugline: () => '',
      storyMeta: () => '',
      words: { board: 'Board', file: 'File' },
    };
    const h = cardHeight(img, img.w, ctx) ?? 180;
    expect(h).toBeGreaterThan(100);

    const ops = drawCard({ el: img, x: img.x, y: img.y, w: img.w, h }, ctx);
    const flatten = (list: readonly Op[]): Op[] =>
      list.flatMap((op) => (op.kind === 'clip' ? [op, ...flatten(op.ops)] : [op]));
    const imgOp = flatten(ops).find(
      (op): op is Extract<Op, { kind: 'image' }> => op.kind === 'image',
    );
    expect(imgOp).toBeDefined();
    if (imgOp) {
      expect(imgOp.crop).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.5, aspect: '1:1' });
      expect(imgOp.rotation).toBe(90);

      const placement = imagePlacement({ width: 1200, height: 800 }, imgOp);
      expect(placement.transformed).toBe(true);
      expect(placement.rotation).toBe(90);
      expect(placement.drawW).toBeGreaterThan(imgOp.w);
      expect(placement.drawH).toBeGreaterThan(imgOp.h);
    }
  });
});
