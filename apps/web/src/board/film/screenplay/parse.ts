import { parseFdx } from './fdx.ts';
import { parseFountain } from './fountain.ts';
import { MAX_SCRIPT_BYTES, type Script, ScriptError } from './script.ts';

export const SCRIPT_EXTENSIONS = ['.fountain', '.spmd', '.txt', '.fdx', '.pdf'] as const;

/** Picks the parser from the file name, or from the content for a misnamed file. */
export function parseScreenplay(name: string, text: string): Script {
  const ext = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? '';
  if (!(SCRIPT_EXTENSIONS as readonly string[]).includes(ext)) throw new ScriptError('unsupported');
  // Characters are at most 4 bytes, so this bounds the work also before encoding.
  if (text.length > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
  const xml = /^﻿?\s*<(?:\?xml|FinalDraft)/.test(text);
  const script = ext === '.fdx' || xml ? parseFdx(text) : parseFountain(text);
  if (script.scenes.length === 0) throw new ScriptError('empty');
  return script;
}

/** Reads a picked or dropped file; the size is checked before the text is read. */
export async function readScreenplay(file: File): Promise<Script> {
  if (file.size > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const { readPdfScreenplay } = await import('./pdf.ts');
    return readPdfScreenplay(file);
  }
  return parseScreenplay(file.name, await file.text());
}

/** Count actual headings, excluding the parser's prelude or forced untitled scenes. */
export function looksLikeScreenplay(script: Script): boolean {
  return script.scenes.filter((scene) => scene.setting && !scene.prelude).length >= 5;
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
