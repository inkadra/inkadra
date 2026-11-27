import {
  looksLikeScreenplay,
  parseScreenplay,
  SCRIPT_EXTENSIONS,
} from '@inkadra/canvas-core/screenplay/parse';
import { MAX_SCRIPT_BYTES, type Script, ScriptError } from '@inkadra/canvas-core/screenplay/script';

// Parsing moved to an MPL package (decision 0116); reading a browser `File` stays here.
export { looksLikeScreenplay, parseScreenplay, SCRIPT_EXTENSIONS };

/**
 * Reads a picked or dropped file; the size is checked before the text is read. Every format is
 * parsed in a disposable worker, terminated with the whole parser at the deadline.
 */
export async function readScreenplay(file: File): Promise<Script> {
  if (file.size > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
  const worker = new Worker(new URL('./screenplay.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Script>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ScriptError('timeout')), 10_000);
      worker.onmessage = (
        event: MessageEvent<{ kind?: string; script?: Script; error?: ScriptError['code'] }>,
      ) => {
        if (event.data.kind !== 'screenplay') return;
        clearTimeout(timer);
        if (event.data.script) resolve(event.data.script);
        else reject(new ScriptError(event.data.error ?? 'invalid'));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new ScriptError('invalid'));
      };
      worker.postMessage(file);
    });
  } finally {
    worker.terminate();
  }
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
