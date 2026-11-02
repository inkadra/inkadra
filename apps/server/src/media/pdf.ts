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
      // The Info dictionary (title, subject, keywords) comes first and can be huge.
      maxBuffer: 16 * 1024 * 1024,
    });
    return parsePdfInfo(stdout.toString('utf8'));
  } catch (err) {
    // Past even that, what was printed may still hold the page count.
    const partial = (err as { code?: string; stdout?: Buffer }).stdout;
    if ((err as { code?: string }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && partial)
      return parsePdfInfo(partial.toString('utf8'));
    return { pageCount: null, encrypted: false };
  }
}

/**
 * Renders page 1 of a PDF to `<outPrefix>.png`, its longer side 2048 pixels, with poppler's
 * pdftoppm: within the crop box, as viewers show it, on white. Only page 1 is ever read, so a
 * 500-page PDF costs what a 1-page one does. Poppler runs no scripts and fetches nothing.
 * Returns the PNG path, or null when the PDF does not render (encrypted, broken).
 */
export async function renderFirstPage(pdftoppm: string, file: string, outPrefix: string, page = 1) {
  const out = `${outPrefix}.png`;
  try {
    await runTool(
      pdftoppm,
      [
        '-f',
        String(page),
        '-l',
        String(page),
        '-singlefile',
        '-png',
        '-cropbox',
        '-scale-to',
        String(RENDER_SIZE),
        file,
        outPrefix,
      ],
      // A 2048 px PNG is a few MB; nothing it writes may grow past 256 MB.
      { timeoutMs: POPPLER_TIMEOUT_MS, memoryBytes: POPPLER_MEMORY, fileBytes: 256 * 1024 ** 2 },
    );
  } catch {
    return null;
  }
  return ((await stat(out).catch(() => null))?.size ?? 0) > 0 ? out : null;
}
