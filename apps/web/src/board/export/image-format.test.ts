// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  ASPECT_PIXELS,
  clampFocus,
  focusAfterKey,
  formatPage,
  imageNames,
  imagePages,
  manyMode,
  ORIGINAL_IMAGE,
  placeContent,
} from './image-format.ts';
import type { Page } from './pages.ts';

const wide: Page = { width: 3000, height: 2000, background: '#111111', ops: [] };

describe('image formats', () => {
  it('makes every social format 1080 pixels on the short side', () => {
    expect(ASPECT_PIXELS).toEqual({
      '4:5': { width: 1080, height: 1350 },
      '1:1': { width: 1080, height: 1080 },
      '9:16': { width: 1080, height: 1920 },
      '16:9': { width: 1920, height: 1080 },
    });
  });

  it('fits all of the content, centred, whatever the focus point', () => {
    const at = placeContent(wide, { width: 1080, height: 1920 }, 'fit', { x: 0, y: 0 });
    expect(at.x).toBeCloseTo(0);
    expect(at.y).toBeCloseTo(600);
    expect(at.width).toBeCloseTo(1080);
    expect(at.height).toBeCloseTo(720);
  });

  it('fills the box and lets the focus point choose the part that is cut', () => {
    const box = { width: 1080, height: 1350 };
    const at = (x: number) => placeContent(wide, box, 'fill', { x, y: 0.5 });
    expect(at(0.5).scale).toBeCloseTo(0.675);
    expect(at(0.5).width).toBeCloseTo(2025);
    expect(at(0.5).height).toBeCloseTo(1350);
    expect(at(0.5).y).toBeCloseTo(0);
    expect(at(0).x).toBeCloseTo(0);
    expect(at(1).x).toBeCloseTo(1080 - 2025);
    expect(at(0.5).x).toBeCloseTo((1080 - 2025) / 2);
  });

  it('keeps the focus point inside the picture', () => {
    expect(clampFocus({ x: -3, y: 1.2 })).toEqual({ x: 0, y: 1 });
    expect(
      placeContent(wide, { width: 1080, height: 1350 }, 'fill', { x: 9, y: -9 }).x,
    ).toBeCloseTo(1080 - 2025);
    expect(focusAfterKey({ x: 0.5, y: 0.5 }, 'ArrowRight', false)).toEqual({ x: 0.52, y: 0.5 });
    expect(focusAfterKey({ x: 0.5, y: 0.5 }, 'ArrowUp', true)).toEqual({ x: 0.5, y: 0.4 });
    expect(focusAfterKey({ x: 0.05, y: 0.5 }, 'ArrowLeft', true)).toEqual({ x: 0, y: 0.5 });
    expect(focusAfterKey({ x: 0.5, y: 0.5 }, 'Enter', false)).toBeNull();
  });

  it('draws the bars of Fit in the board background colour', () => {
    const page = formatPage(wide, '9:16', 'fit', undefined, '#161616');
    expect(page).toMatchObject({ width: 1080, height: 1920, background: '#161616' });
  });

  it('keeps white paper under a page of the document, whatever the bars', () => {
    const doc: Page = { width: 842, height: 595, ops: [] };
    const page = formatPage(doc, '9:16', 'fit', undefined, '#161616');
    expect(page.background).toBe('#161616');
    expect(page.ops[0]).toMatchObject({
      kind: 'clip',
      ops: [{ kind: 'rect', fill: '#FFFFFF', x: 0, w: 1080 }],
    });
  });

  it('leaves a transparent picture transparent when nothing is added around it', () => {
    const clear: Page = { ...wide, background: null };
    expect(formatPage(clear, '4:5', 'fill', undefined, '#161616').background).toBeNull();
    expect(formatPage(clear, '4:5', 'fit', undefined, '#161616').background).toBe('#161616');
  });

  it('uses the focus point of each image', () => {
    const box: Page = {
      ...wide,
      ops: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000, fill: '#222222' }],
    };
    const { pages, scales } = imagePages(
      [box, box],
      { aspect: '4:5', fit: 'fill', many: null, foci: { 1: { x: 0, y: 0 } }, band: '#161616' },
    );
    expect(scales).toEqual([1, 1]);
    const x = (page: Page | undefined) => {
      const clip = page?.ops[0];
      const rect = clip?.kind === 'clip' ? clip.ops[0] : undefined;
      return rect?.kind === 'rect' ? rect.x : null;
    };
    expect(x(pages[0])).toBeCloseTo((1080 - 2025) / 2);
    expect(x(pages[1])).toBeCloseTo(0);
  });

  it('paints the bands in the chosen colour, whichever theme is on', () => {
    document.documentElement.style.setProperty('--ink-bg-canvas', '#123456');
    const out = imagePages([wide], { ...ORIGINAL_IMAGE, aspect: '9:16', fit: 'fit', band: '#3A5A7C' });
    expect(out.pages[0]?.background).toBe('#3A5A7C');
    expect(ORIGINAL_IMAGE.band).toBe('#000000');
  });

  it('never enlarges a picture past its own pixels in Original', () => {
    const picture: Page = { width: 2048, height: 1365, maxScale: 1, background: null, ops: [] };
    const card: Page = { width: 400, height: 300, background: '#111111', ops: [] };
    expect(imagePages([picture], ORIGINAL_IMAGE).scales).toEqual([1]);
    expect(imagePages([card], ORIGINAL_IMAGE).scales).toEqual([4]);
  });

  it('makes one image per card the default with a social format only', () => {
    expect(manyMode({ aspect: '4:5', many: null })).toBe('each');
    expect(manyMode({ aspect: 'original', many: null })).toBe('one');
    expect(manyMode({ aspect: '4:5', many: 'one' })).toBe('one');
    expect(manyMode({ aspect: 'original', many: 'each' })).toBe('each');
  });

  it('names the files like the pages of #397, with the extension of the format', () => {
    expect(imageNames('Spot', 1, 'png')).toEqual(['Spot.png']);
    expect(imageNames('Spot', 1, 'jpeg')).toEqual(['Spot.jpg']);
    expect(imageNames('Spot', 2, 'jpeg')).toEqual(['Spot-001.jpg', 'Spot-002.jpg']);
    expect(imageNames('Spot', 12, 'png').at(-1)).toBe('Spot-012.png');
  });
});
