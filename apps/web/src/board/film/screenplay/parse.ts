import {
  looksLikeScreenplay,
  parseScreenplay,
  SCRIPT_EXTENSIONS,
} from '@inkadra/canvas-core/screenplay/parse';
import { MAX_SCRIPT_BYTES, type Script, ScriptError } from '@inkadra/canvas-core/screenplay/script';

// Parsing moved to an MPL package (decision 0116); reading a browser `File` stays here.
export { looksLikeScreenplay, parseScreenplay, SCRIPT_EXTENSIONS };

/** Reads a picked or dropped file; the size is checked before the text is read. */
export async function readScreenplay(file: File): Promise<Script> {
  if (file.size > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const { readPdfScreenplay } = await import('./pdf.ts');
    return readPdfScreenplay(file);
  }
  return parseScreenplay(file.name, await file.text());
}

/** One bounded read per upload; ordinary documents and unreadable files stay file cards. */
export async function detectScreenplay(file: File): Promise<Script | null> {
  if (!SCRIPT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) return null;
  try {
    const script = await readScreenplay(file);
    return looksLikeScreenplay(script) ? script : null;
  } catch {
    return null;
  }
}
