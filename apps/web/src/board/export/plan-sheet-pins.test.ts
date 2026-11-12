// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import { planSheetFixtureFull } from '@inkadra/canvas-core/fixtures/plan-sheet';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  type PDFObject,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { expectFixture } from '../plan/plan-sample.fixture.ts';
import { greyPixels, type LoadedImage } from './images.ts';
import type { FontWeight, Page } from './pages.ts';
import {
  FLOOR_PLAN_JPEG,
  fileFetch,
  packageFile,
  sheetOf,
  sheetText,
} from './plan-sheet-node.fixture.ts';
import { renderPdf } from './render-pdf.ts';

/**
 * What the sheet's goldens did not cover before the sheet's code moves to a package (the server's
 * PDF, step 2, slice 0): the background placed, at 0.6, in greys; locked icons and walls; a text
 * of three lines; turned furniture wider than deep; the PDF writer's own output; the greys.
 * Recorded from `main` with `WRITE_PLAN_FIXTURES=1`; a move must leave them as they are.
 *
 * Node has no `createImageBitmap` nor `OffscreenCanvas`, which the web's grey picture
 * (`greyBytes`) decodes and encodes with: here they are stand-ins that give back the JPEG they
 * were handed, so the writer embeds a picture and its drawing operators are pinned; the greys
 * themselves are pinned on pixels by `greyPixels`' golden.
 */

const golden = (name: string) => `${import.meta.dirname}/golden/${name}`;

/** The browser's picture API, as little as `greyBytes` uses, returning the bytes unchanged. */
class StandInCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    const { width, height } = this;
    return {
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData() {},
    };
  }
  async convertToBlob() {
    return new Blob([FLOOR_PLAN_JPEG as BlobPart], { type: 'image/jpeg' });
  }
}

beforeAll(() => {
  vi.stubGlobal('fetch', fileFetch);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 48, height: 32, close() {} }));
  vi.stubGlobal('OffscreenCanvas', StandInCanvas);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** Inter as `fonts.ts` loads it, from `@fontsource/inter` on disk. */
function inter(): Record<FontWeight, Uint8Array> {
  const file = (w: number) => packageFile(`@fontsource/inter/files/inter-latin-${w}-normal.woff`);
  const semibold = file(600);
  return { 400: file(400), 500: file(500), 600: semibold, 700: file(700), heading: semibold };
}

/**
 * The drawing operators of a page of `bytes`, decompressed, one per line; the resource names'
 * random numbers (`/Image-1234`, `/GS-5678`, the fonts') as `#`, so the text is the same every
 * time. Dates and object numbers live outside the page's contents.
 */
async function pageOperators(bytes: Uint8Array, index: number): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const node = pdf.getPage(index).node;
  const contents = node.Contents();
  if (!contents) throw new Error('A page without contents');
  const parts: PDFObject[] = contents instanceof PDFArray ? contents.asArray() : [contents];
  const text = parts
    .map((part) => (part instanceof PDFRef ? pdf.context.lookup(part) : part))
    .map((stream) => {
      if (!(stream instanceof PDFRawStream)) throw new Error('Unexpected page contents');
      return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
    })
    .join('\n');
  return `${text
    .replace(/\/([A-Za-z]+(?:-[A-Za-z]+)*)-\d+/g, '/$1-#')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')}\n`;
}

const META = { title: 'Pins', author: '', subject: 'Set plan', language: 'en' };

describe('the fuller sheet fixture', () => {
  it('is the golden list of drawing operations, its background in greys at 0.6', async () => {
    const fixture = planSheetFixtureFull();
    const { built } = await sheetOf(fixture, 'team', 'en');
    expect(built.pages).toHaveLength(3);
    const text = sheetText(built.pages, built.missing);
    // What the golden is for: the picture under the plan as the sheet asks for it.
    expect(text).toContain('"opacity":0.6,"grey":true');
    expectFixture(text, golden('plan-sheet-team-en-full.txt'));
  });

  it('is written to the PDF as the golden operators of its first page', async () => {
    const fixture = planSheetFixtureFull();
    const { built } = await sheetOf(fixture, 'team', 'en');
    const images = new Map<string, LoadedImage>(built.images);
    images.set(fixture.backgroundId, {
      width: 48,
      height: 32,
      bytes: FLOOR_PLAN_JPEG,
      type: 'jpeg',
    });
    const bytes = await renderPdf(built.pages, built.fonts.bytes, images, META);
    const ops = await pageOperators(bytes, 0);
    // The grey picture is drawn, see-through: its graphics state and its XObject.
    expect(ops).toMatch(/\/GS-# gs/);
    expect(ops).toMatch(/\/Image-# Do/);
    expectFixture(ops, golden('plan-sheet-team-en-full-pdf.txt'));
    // The same operators a second time: nothing random is left in them.
    const again = await renderPdf(built.pages, built.fonts.bytes, images, META);
    expect(await pageOperators(again, 0)).toBe(ops);
  });
});

describe('pictures in the PDF writer', () => {
  it('writes cropped and turned pictures, see-through and in greys, as the golden operators', async () => {
    const base = { kind: 'image', key: 'floor', fit: 'cover' } as const;
    const page: Page = {
      width: 300,
      height: 200,
      ops: [
        { ...base, x: 10, y: 10, w: 80, h: 60 },
        { ...base, x: 100, y: 10, w: 80, h: 60, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 } },
        {
          ...base,
          x: 190,
          y: 10,
          w: 80,
          h: 60,
          crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 },
          rotation: 90,
          opacity: 0.6,
          grey: true,
        },
        { ...base, x: 10, y: 100, w: 120, h: 80, rotation: 270, fit: 'contain', opacity: 0.4 },
        { ...base, x: 150, y: 100, w: 120, h: 80, rotation: 180, grey: true },
      ],
    };
    const images = new Map<string, LoadedImage>([
      ['floor', { width: 48, height: 32, bytes: FLOOR_PLAN_JPEG, type: 'jpeg' }],
    ]);
    const bytes = await renderPdf([page], inter(), images, META);
    expectFixture(await pageOperators(bytes, 0), golden('render-pdf-pictures.txt'));
  });
});

describe('greys', () => {
  it('turns a 4 × 4 picture to the golden greys, alpha kept', () => {
    // Primaries, mixes, greys, the rounding edges and four alphas.
    const rgba = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [128, 128, 128, 255],
      [255, 255, 0, 200],
      [0, 255, 255, 128],
      [255, 0, 255, 64],
      [1, 2, 3, 0],
      [200, 100, 50, 255],
      [50, 100, 200, 255],
      [17, 34, 51, 255],
      [254, 1, 127, 255],
      [3, 3, 2, 255],
      [157, 184, 242, 255],
    ].flat();
    const out = greyPixels(new Uint8ClampedArray(rgba));
    const rows = Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 4 }, (_, c) => {
        const i = (r * 4 + c) * 4;
        return Array.from(out.slice(i, i + 4)).join(',');
      }).join(' '),
    );
    expectFixture(`${rows.join('\n')}\n`, golden('grey-pixels.txt'));
  });
});
