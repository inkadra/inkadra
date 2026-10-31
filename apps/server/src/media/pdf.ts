import { stat } from 'node:fs/promises';
import { runTool } from './tools.ts';

/** Address space of one poppler run: a page of a huge poster fits, a bomb does not. */
const POPPLER_MEMORY = 1024 ** 3;
const POPPLER_TIMEOUT_MS = 30_000;

/** Longest side of the rendered first page, in pixels: the widest thumbnail. */
const RENDER_SIZE = 2048;

/** True when the first bytes hold a PDF header (`%PDF-`), which may follow some junk. */
export function isPdf(head: Uint8Array): boolean {
  return Buffer.from(head.buffer, head.byteOffset, head.byteLength)
    .toString('latin1')
    .includes('%PDF-');
}

/** Pages and encryption from the text `pdfinfo` prints. */
export function parsePdfInfo(text: string) {
  const pages = Number(/^Pages:\s+(\d+)\s*$/m.exec(text)?.[1]);
  return {
    pageCount: Number.isInteger(pages) && pages > 0 ? pages : null,
    encrypted: /^Encrypted:\s+yes/m.test(text),
  };
}

/**
 * Page count of a PDF, from poppler's pdfinfo. Null when it cannot be read: broken, or
 * encrypted with a password to open it.
 */
export async function readPdfInfo(pdfinfo: string, file: string) {
  try {
    const stdout = await runTool(pdfinfo, [file], {
      timeoutMs: POPPLER_TIMEOUT_MS,
      memoryBytes: POPPLER_MEMORY,
      maxBuffer: 256 * 1024,
    });
    return parsePdfInfo(stdout.toString('utf8'));
  } catch {
    return { pageCount: null, encrypted: false };
  }
}

/**
 * Renders page 1 of a PDF to `<outPrefix>.png`, its longer side 2048 pixels, with poppler's
 * pdftoppm: within the crop box, as viewers show it, on white. Only page 1 is ever read, so a
 * 500-page PDF costs what a 1-page one does. Poppler runs no scripts and fetches nothing.
 * Returns the PNG path, or null when the PDF does not render (encrypted, broken).
 */
export async function renderFirstPage(pdftoppm: string, file: string, outPrefix: string) {
  const out = `${outPrefix}.png`;
  try {
    await runTool(
      pdftoppm,
      [
        '-f',
        '1',
        '-l',
        '1',
        '-singlefile',
        '-png',
        '-cropbox',
        '-scale-to',
        String(RENDER_SIZE),
        file,
        outPrefix,
      ],
      { timeoutMs: POPPLER_TIMEOUT_MS, memoryBytes: POPPLER_MEMORY },
    );
  } catch {
    return null;
  }
  return ((await stat(out).catch(() => null))?.size ?? 0) > 0 ? out : null;
}
