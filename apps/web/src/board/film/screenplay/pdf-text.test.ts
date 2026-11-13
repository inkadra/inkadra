// @vitest-environment node
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { buildScriptPdf } from './fixtures/script-pdf.ts';
import {
  type PdfPage,
  parseFountain,
  pdfPagesToFountain,
} from '@inkadra/canvas-core/screenplay';

/** The text layer as the import worker reads it, with pdf.js itself. */
async function pagesOf(bytes: Uint8Array): Promise<PdfPage[]> {
  const pdf = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    pages.push({
      width: 612,
      items: items.flatMap((i) =>
        'str' in i
          ? [{ str: i.str, x: i.transform[4] ?? 0, y: i.transform[5] ?? 0, height: i.height }]
          : [],
      ),
    });
  }
  return pages;
}

it('imports a Celtx-style PDF as its six scenes, with the title page as metadata', async () => {
  const script = parseFountain(pdfPagesToFountain(await pagesOf(await buildScriptPdf())));
  expect(script.scenes.map((s) => [s.number, s.heading, s.prelude])).toEqual([
    ['1', 'EXT. STRADA FUORI CASA - NIGHT', undefined],
    ['2', 'INT. SCALE CONDOMINIO - NIGHT', undefined],
    ['3', 'INT. CASA LUCA - NIGHT', undefined],
    ['4', 'INT. INGRESSO CASA - NIGHT', undefined],
    ['5', 'INT. CAMERA DI LUCA - NIGHT', undefined],
    ['6', 'INT. SALOTTO FESTA - NIGHT', undefined],
  ]);
  expect(script.titlePage).toEqual({
    title: 'UNA FESTA DI PROVA.',
    credit: 'Written by',
    author: 'Anna Rossi, Luca Bianchi',
    revision: 'First Draft',
    'draft date': '01/02/2026',
  });
  expect(script.title).toBe('UNA FESTA DI PROVA.');
});

it('leaves no page numbers, footers or page-break splits in actions and dialogue', async () => {
  const script = parseFountain(pdfPagesToFountain(await pagesOf(await buildScriptPdf())));
  const text = JSON.stringify(script.scenes);
  expect(text).not.toContain('Celtx');
  expect(script.scenes.flatMap((s) => s.blocks).filter((b) => b.kind === 'action')).toSatisfy(
    (blocks: Array<{ text: string }>) => blocks.every((b) => !/^\d+\.$/.test(b.text)),
  );
  expect(script.scenes[0]?.blocks).toEqual([
    {
      kind: 'action',
      text: 'ESTABLISHING SHOT: Vediamo i fari di una macchina spegnersi, in un parcheggio fuori da un condominio. LUCA (25) scende frettolosamente e fa per entrare nel palazzo.',
    },
    { kind: 'transition', text: 'CUT TO' },
  ]);
  // A paragraph cut by a page break is one action; so is a speech.
  const four = script.scenes[3]?.blocks ?? [];
  expect(four.filter((b) => b.kind === 'action').at(-1)).toEqual({
    kind: 'action',
    text: 'Tutta l’attenzione degli invitati si concentra su ANNA e sul suo infortunio.',
  });
  const five = script.scenes[4]?.blocks ?? [];
  expect(five.at(-2)).toMatchObject({
    kind: 'dialogue',
    character: 'SEBASTIANO',
    lines: [{ text: 'Ma come hai fatto a salire con le scale e il gesso?' }],
  });
});

it('keeps a wrapped parenthetical in one piece', async () => {
  const script = parseFountain(pdfPagesToFountain(await pagesOf(await buildScriptPdf())));
  const giorgia = script.scenes[3]?.blocks.find(
    (b) => b.kind === 'dialogue' && b.character === 'GIORGIA' && b.lines.length > 1,
  );
  expect(giorgia).toMatchObject({
    lines: [
      { text: '(passando la stampella a Luca)', parenthetical: true },
      { text: 'Mettile da qualche parte!' },
    ],
  });
});

it('reads GIORGIA and GIORGIA V.O. as one character', async () => {
  const script = parseFountain(pdfPagesToFountain(await pagesOf(await buildScriptPdf())));
  expect(script.characters).toEqual(['TUTTI', 'ANNA', 'SEBASTIANO', 'GIORGIA']);
  const voices = script.scenes
    .flatMap((s) => s.blocks)
    .filter((b) => b.kind === 'dialogue' && b.character === 'GIORGIA');
  expect(voices.map((b) => (b.kind === 'dialogue' ? b.extension : 'x'))).toEqual([
    '(V.O.)',
    undefined,
    '(V.O.)',
  ]);
});

const page = (...lines: Array<[number, number, string]>): PdfPage => ({
  width: 612,
  items: lines.map(([x, y, str]) => ({ str, x, y, height: 12 })),
});

it('drops MORE and CONTINUED markers and lines repeated at the edge of the pages', () => {
  const header = (y = 750): [number, number, string] => [108, y, 'DRAFT 2 – CONFIDENTIAL'];
  const text = pdfPagesToFountain([
    page(
      header(),
      [108, 707, 'INT. KITCHEN - DAY'],
      [245, 681, 'ANNA'],
      [173, 668, 'Wait for me'],
      [245, 655, '(MORE)'],
    ),
    page(
      header(),
      [245, 707, "ANNA (CONT'D)"],
      [173, 694, 'at the door.'],
      [108, 30, '(CONTINUED)'],
    ),
    page(header(), [108, 707, 'INT. HALL - DAY'], [108, 681, 'Empty.']),
  ]);
  const script = parseFountain(text);
  expect(script.scenes.map((s) => s.heading)).toEqual(['INT. KITCHEN - DAY', 'INT. HALL - DAY']);
  expect(JSON.stringify(script)).not.toMatch(/MORE|CONFIDENTIAL|CONTINUED/);
  expect(script.characters).toEqual(['ANNA']);
});

it('does not take a first page with action for a title page', () => {
  const script = parseFountain(
    pdfPagesToFountain([
      page([108, 707, 'FADE IN'], [108, 681, 'A road at dawn.']),
      page([108, 707, 'EXT. ROAD - DAWN'], [108, 681, 'A car.']),
    ]),
  );
  expect(script.scenes[0]).toMatchObject({ prelude: true });
  expect(script.scenes).toHaveLength(2);
});
