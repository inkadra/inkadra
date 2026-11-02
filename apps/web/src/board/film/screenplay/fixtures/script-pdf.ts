import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * A small screenplay PDF laid out the way Celtx exports one (US Letter, Courier 12): a title
 * page, numbered scene headings in the left margin, a page number at the top of every page after
 * the first, "Created using Celtx" at the bottom of every page after the title, and paragraphs
 * and dialogue that a page break cuts in two. Generated here so no real script is committed.
 *
 * A string is a line, indented by its leading spaces (6 points each); '' is a blank line; a
 * number moves to that height on the page. Six scenes, four speakers.
 */
const CUE = ' '.repeat(23);
const SPEECH = ' '.repeat(11);
const PAREN = ' '.repeat(17);
const RIGHT = ' '.repeat(66);
const NUMBER = ' '.repeat(70);
const CENTRE = ' '.repeat(18);

export const SCRIPT_PDF_PAGES: Array<Array<string | number>> = [
  [
    551,
    `${CENTRE}UNA FESTA DI PROVA.`,
    '',
    `${CENTRE}      Written by`,
    `${CENTRE}      Anna Rossi`,
    `${CENTRE}     Luca Bianchi`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    `${CENTRE}First Draft: 01/02/2026`,
  ],
  [
    707,
    '1 EXT. STRADA FUORI CASA - NIGHT',
    '',
    'ESTABLISHING SHOT: Vediamo i fari di una macchina spegnersi,',
    'in un parcheggio fuori da un condominio. LUCA (25) scende',
    'frettolosamente e fa per entrare nel palazzo.',
    '',
    `${RIGHT}CUT TO`,
    '',
    '2 INT. SCALE CONDOMINIO - NIGHT',
    '',
    'Vediamo LUCA correre su per le scale, arriva al piano e fa',
    'per entrare in casa, ma si ferma. Si prende un attimo per',
    'controllare che ci siano le scarpe sul pianerottolo',
    'superiore.',
    '',
    '3 INT. CASA LUCA - NIGHT',
    '',
    'Seguiamo LUCA che entra e si ritrova alla sua festa a',
    'sorpresa.',
    '',
    `${CUE}TUTTI`,
    `${SPEECH}Sorpresa!!!`,
    '',
    '4 INT. INGRESSO CASA - NIGHT',
    '',
    'Si palesa ANNA con un vistoso gesso alla gamba, sorretta',
    'dalle stampelle e da GIORGIA.',
    '',
    `${CUE}ANNA`,
    `${SPEECH}Bella raga, scusate il ritardo!`,
    57,
    'Tutta l’attenzione degli invitati si concentra su ANNA e sul',
  ],
  [
    746,
    `${NUMBER}2.`,
    707,
    'suo infortunio.',
    '',
    `${CUE}SEBASTIANO`,
    `${SPEECH}Noooo, ma che hai combinato?`,
    '',
    `${CUE}GIORGIA V.O.`,
    `${SPEECH}Si esatto, datemi una mano.`,
    '',
    `${CUE}GIORGIA`,
    `${PAREN}(passando la stampella`,
    `${PAREN}a Luca)`,
    `${SPEECH}Mettile da qualche parte!`,
    '',
    '5 INT. CAMERA DI LUCA - NIGHT',
    '',
    'Vediamo LUCA in camera prendere un pennarello, borbottando',
    'tra sè e sè e facendo il verso di ANNA, con la faccia di chi',
    'ha già capito tutto.',
    70,
    `${CUE}SEBASTIANO`,
    `${SPEECH}Ma come hai fatto a salire con le scale`,
  ],
  [
    746,
    `${NUMBER}3.`,
    707,
    `${SPEECH}e il gesso?`,
    '',
    `${CUE}GIORGIA (V.O.)`,
    `${SPEECH}Tutti vogliono firmare.`,
    '',
    '6 INT. SALOTTO FESTA - NIGHT',
    '',
    'LUCA torna e cerca di farsi spazio per dare il pennarello.',
  ],
];

/** The pages as a PDF: top of the text area at 707 (the usual Celtx first line), 13 points apart. */
export async function buildScriptPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  SCRIPT_PDF_PAGES.forEach((lines, index) => {
    const page = pdf.addPage([612, 792]);
    let y = 707;
    for (const line of lines) {
      if (typeof line === 'number') {
        y = line;
        continue;
      }
      const text = line.trimStart();
      if (text) {
        const x = 108 + (line.length - text.length) * 6;
        page.drawText(text, { x, y, size: 12, font });
      }
      y -= 13;
    }
    if (index > 0) page.drawText('Created using Celtx', { x: 108, y: 18, size: 12, font });
  });
  return pdf.save();
}
