// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { FontWeight, Page } from './ops.ts';
import { type PdfImage, renderPdf } from './pdf.ts';

const require = createRequire(import.meta.url);

/** Inter as the web loads it, read from `@fontsource/inter` on disk (a test-only dependency). */
function inter(): Record<FontWeight, Uint8Array> {
  const file = (w: number) =>
    readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));
  const semibold = file(600);
  return { 400: file(400), 500: file(500), 600: semibold, 700: file(700), heading: semibold };
}

const bytesOf = (base64: string) => Uint8Array.from(Buffer.from(base64, 'base64'));

/** A 48 × 32 JPEG in colour. */
const JPEG = bytesOf(
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABrAAADAQEBAQAAAAAAAAAAAAAFBgABBAIHAQEBAQAAAAAAAAAAAAAAAAAAAQMQAAECAwQJBQEAAAAAAAAAAAECAwAEERVkk+IhBRNTQdGSURIxIrOCNHIRAQEAAAAAAAAAAAAAAAAAAACB/8AAEQgAIAAwAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8A+tzD6ZZpTqwSlNK+NK6SBxI7wJtG6TuDmjdagqknQASfZ6f2mDG3Z3jfUnnGag1o3Sdwc0Vo3Sdwc0GduzvG+pPOLbs7xvqTziwBrRuk7g5oLS76ZlpLqAQlVaeVK6CRwJ7R727O8b6k84D6qBTJNAgg+/1/tUQZrf8AC99PkTDHHFMMJmWlNLJCVUr40roIPEHtAmzr3O42WCmOKFyzr3O42WKzr3O42WAY4XNUfhZ+/wAiorOvc7jZYLS7CZZpLSCSlNaeVK6STwA7wH//2Q==',
);

/** A 3 × 2 PNG in greys (the JPEG's shape), what the test's grey provider gives back. */
const GREY_PNG = bytesOf(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAAAAAC4HznGAAAADklEQVR4nGNocDjBAMQAC7gDEW8W+sAAAAAASUVORK5CYII=',
);

const META = { title: 'Pictures', author: '', subject: 'Test', language: 'en' };

/** Page 1 with a picture in colour and the same picture twice in greys, see-through. */
const PAGE: Page = {
  width: 200,
  height: 100,
  ops: [
    { kind: 'image', key: 'floor', x: 10, y: 10, w: 48, h: 32, fit: 'cover' },
    {
      kind: 'image',
      key: 'floor',
      x: 70,
      y: 10,
      w: 48,
      h: 32,
      fit: 'cover',
      grey: true,
      opacity: 0.6,
    },
    { kind: 'image', key: 'floor', x: 130, y: 10, w: 48, h: 32, fit: 'cover', grey: true },
    { kind: 'text', text: 'Floor', x: 10, y: 60, size: 10, weight: 400, color: '#202020' },
  ],
};

const IMAGES = new Map<string, PdfImage>([
  ['floor', { width: 48, height: 32, bytes: JPEG, type: 'jpeg' }],
]);

/**
 * The page's drawing operators, one per line, the resources' random numbers as `#`, and the
 * filter of each picture it draws: what is the same however often it is written (dates and
 * subset tags are not).
 */
async function written(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const node = pdf.getPage(0).node;
  const contents = node.Contents();
  if (!contents) throw new Error('A page without contents');
  const parts = contents instanceof PDFArray ? contents.asArray() : [contents];
  const ops = parts
    .map((part) => (part instanceof PDFRef ? pdf.context.lookup(part) : part))
    .map((stream) => {
      if (!(stream instanceof PDFRawStream)) throw new Error('Unexpected page contents');
      return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
    })
    .join('\n')
    .replace(/\/([A-Za-z]+(?:-[A-Za-z]+)*)-\d+/g, '/$1-#')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const xObjects = node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  // pdf-lib names a picture once per drawing; each picture is one object.
  const refs = new Map((xObjects?.values() ?? []).map((ref) => [ref.toString(), ref]));
  const pictures = [...refs.values()]
    .map((ref) => pdf.context.lookup(ref))
    .map((stream) => (stream instanceof PDFRawStream ? stream.dict : null))
    .map((dict) =>
      [
        dict?.get(PDFName.of('Filter'))?.toString(),
        dict?.get(PDFName.of('ColorSpace'))?.toString(),
        `${dict?.get(PDFName.of('Width'))}x${dict?.get(PDFName.of('Height'))}`,
      ].join(' '),
    )
    .sort();
  return { ops, pictures };
}

describe('renderPdf', () => {
  it('draws the pictures in greys the provider gives, asking once per picture', async () => {
    const asked: PdfImage[] = [];
    const grey = async (img: PdfImage): Promise<PdfImage> => {
      asked.push(img);
      return { width: 3, height: 2, bytes: GREY_PNG, type: 'png' };
    };
    const bytes = await renderPdf([PAGE], inter(), IMAGES, META, { grey });
    expect(asked).toEqual([IMAGES.get('floor')]);
    const { ops, pictures } = await written(bytes);
    // The JPEG as given and the provider's PNG (pdf-lib writes it as RGB), nothing else.
    expect(pictures).toEqual(['/DCTDecode /DeviceRGB 48x32', '/FlateDecode /DeviceRGB 3x2']);
    expect(ops.filter((op) => op.endsWith(' Do'))).toEqual([
      '/Image-# Do',
      '/Image-# Do',
      '/Image-# Do',
    ]);
    expect(ops.join('\n')).toBe(OPERATORS);
    // Written again: the same operators, nothing random in them.
    expect((await written(await renderPdf([PAGE], inter(), IMAGES, META, { grey }))).ops).toEqual(
      ops,
    );
  });

  it('leaves out a picture in greys the provider cannot make', async () => {
    const bytes = await renderPdf([PAGE], inter(), IMAGES, META, { grey: async () => null });
    const { ops, pictures } = await written(bytes);
    expect(pictures).toEqual(['/DCTDecode /DeviceRGB 48x32']);
    expect(ops.filter((op) => op.endsWith(' Do'))).toEqual(['/Image-# Do']);
  });

  it('draws a picture in greys as given without a provider', async () => {
    const { ops, pictures } = await written(await renderPdf([PAGE], inter(), IMAGES, META));
    expect(pictures).toEqual(['/DCTDecode /DeviceRGB 48x32']);
    expect(ops.filter((op) => op.endsWith(' Do'))).toHaveLength(3);
  });
});

/**
 * The page's operators: the colour picture, the grey one at 0.6 (its graphics state), the grey one
 * again from the same object, then the text.
 */
const OPERATORS = `1 j
q
1 0 0 1 10 58 cm
1 0 0 1 0 0 cm
48 0 0 32 0 0 cm
1 0 0 1 0 0 cm
/Image-# Do
Q
q
/GS-# gs
1 0 0 1 70 58 cm
1 0 0 1 0 0 cm
48 0 0 32 0 0 cm
1 0 0 1 0 0 cm
/Image-# Do
Q
q
1 0 0 1 130 58 cm
1 0 0 1 0 0 cm
48 0 0 32 0 0 cm
1 0 0 1 0 0 cm
/Image-# Do
Q
q
BT
0.12549019607843137 0.12549019607843137 0.12549019607843137 rg
/Inter-Regular-# 10 Tf
24 TL
1 0 0 1 10 40 Tm
<00010002000300030004> Tj
T*
ET
Q`;
