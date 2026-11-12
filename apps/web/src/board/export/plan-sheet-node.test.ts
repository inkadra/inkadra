// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import { planSheetFixture } from '@inkadra/canvas-core/fixtures/plan-sheet';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportFile } from './engine.ts';
import type { LoadedImage } from './images.ts';
import { pageSize } from './layout.ts';
import {
  FLOOR_PLAN_JPEG,
  fileFetch,
  packageFile,
  type SheetAudience,
  sheetOf,
  sheetText,
} from './plan-sheet-node.fixture.ts';
import { renderPdf } from './render-pdf.ts';

/**
 * The set plan's sheet made in Node without a browser (the server's PDF, step 1): no `window`, no
 * `document`, the web's own code from the plan view's "PDF" button to the PDF's bytes. The golden
 * files are the same ones the browser environment's test compares with
 * (`plan-sheet-dom.test.ts`), so the two sheets are the same list of drawing operations.
 */

beforeAll(() => {
  vi.stubGlobal('fetch', fileFetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('runs where there is no DOM', () => {
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
  expect(typeof createImageBitmap).toBe('undefined');
  expect(typeof OffscreenCanvas).toBe('undefined');
});

describe.each([
  ['team', 'en'],
  ['team', 'it'],
  ['guest', 'en'],
  ['guest', 'it'],
] as const)('the sheet for the %s in %s', (audience: SheetAudience, lng) => {
  it('is the golden list of drawing operations', async () => {
    const { built } = await sheetOf(planSheetFixture(), audience, lng);
    expect(typeof document).toBe('undefined');
    expect(built.pages).toHaveLength(3);
    await expect(sheetText(built.pages, built.missing)).toMatchFileSnapshot(
      `./golden/plan-sheet-${audience}-${lng}.txt`,
    );
  });
});

/** The text of each page as pdf.js reads it, as the e2e `set-plan-outputs.spec.ts` does. */
async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  return pages;
}

/** The PDF as `exportFile` writes it, with the background picture given as bytes. */
async function sheetPdf(audience: SheetAudience) {
  const fixture = planSheetFixture();
  const { built, env } = await sheetOf(fixture, audience, 'en');
  const images = new Map<string, LoadedImage>(built.images);
  images.set(fixture.backgroundId, { width: 48, height: 32, bytes: FLOOR_PLAN_JPEG, type: 'jpeg' });
  const bytes = await renderPdf(built.pages, built.fonts.bytes, images, {
    title: env.boardTitle || env.projectName,
    author: env.projectName,
    subject: env.t('export.kindBoard'),
    language: env.language,
  });
  return { fixture, built, bytes };
}

describe('the PDF written in Node', () => {
  it('has a page per setup, A4 landscape, Inter embedded as subsets and the text', async () => {
    const { fixture, built, bytes } = await sheetPdf('team');
    const pdf = await PDFDocument.load(bytes);
    const a4 = pageSize('a4', 'landscape');
    expect(pdf.getPages().map((p) => p.getSize())).toEqual(
      Array(3).fill({ width: a4.width, height: a4.height }),
    );
    expect(pdf.getTitle()).toBe('Set plan · Bancone');

    // Four weights of Inter, each a subset: a font name with pdf-lib's random tag, a font program
    // much smaller than the whole file.
    const fonts = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, obj]) =>
        obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('FontDescriptor')
          ? [obj]
          : [],
      );
    expect(fonts).toHaveLength(4);
    for (const font of fonts) {
      expect(font.get(PDFName.of('FontName'))?.toString()).toMatch(/^\/Inter-\w+-\d{1,4}$/);
      const program = font.lookup(PDFName.of('FontFile2')) ?? font.lookup(PDFName.of('FontFile3'));
      expect(program).toBeInstanceOf(PDFRawStream);
      expect((program as PDFRawStream).getContentsSize()).toBeLessThan(
        packageFile('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf').length,
      );
    }
    // The background picture, once, as the JPEG it was given.
    const pictures = pdf.context
      .enumerateIndirectObjects()
      .filter(
        ([, obj]) =>
          obj instanceof PDFRawStream &&
          obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
      );
    expect(pictures).toHaveLength(1);

    const pages = await pdfText(bytes);
    expect(pages).toHaveLength(3);
    const all = pages.join('\n');
    for (const words of [
      'Setup 1 · Base',
      'Setup 2 · Controcampo',
      'Setup 3 · Dettaglio',
      'SCENE 2 · INT. TAVOLA CALDA',
      'Tavola calda Rosa',
      fixture.hiddenName,
      'A cam',
      'Bandiera 4×4',
    ])
      expect(all).toContain(words);
    // Accented Latin, Polish and Cyrillic are all in Inter (decision 0038): nothing is missing.
    expect(built.missing).toEqual([]);
    for (const note of [fixture.notes.accented, fixture.notes.polish, fixture.notes.cyrillic])
      for (const word of note.split(/[\s,:]+/)) expect(all).toContain(word);
  });

  it('leaves the character hidden from guests out of the guest PDF', async () => {
    const { fixture, bytes } = await sheetPdf('guest');
    const all = (await pdfText(bytes)).join('\n');
    expect(all).toContain('Setup 1 · Base');
    for (const word of fixture.hiddenName.split(' ')) expect(all).not.toContain(word);
  });

  it('writes the same bytes twice once the date and the subsets’ random tags are fixed', async () => {
    const write = async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-12T09:00:00Z'));
      vi.spyOn(Math, 'random').mockReturnValue(0.25);
      const { bytes } = await sheetPdf('team');
      vi.useRealTimers();
      vi.restoreAllMocks();
      return bytes;
    };
    const first = await write();
    const second = await write();
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    // Left free, they are what differs: the creation and modification dates, and the tags.
    const free = await PDFDocument.load((await sheetPdf('team')).bytes);
    expect(free.getCreationDate()?.getFullYear()).toBe(new Date().getFullYear());
  });

  it('runs the whole export in Node, leaving out only the picture it cannot decode', async () => {
    const fixture = planSheetFixture();
    const { req, env } = await sheetOf(fixture, 'team', 'en');
    const { blob, name } = await exportFile(req, env);
    expect(name).toBe('Set plan · Bancone.pdf');
    const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(3);
  });
});
