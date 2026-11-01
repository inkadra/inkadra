import { MAX_SCRIPT_BYTES, type Script, ScriptError } from './script.ts';

/** Isolated worker: terminate the whole parser, including decompression, at the deadline. */
export async function readPdfScreenplay(file: File): Promise<Script> {
  if (file.size > MAX_SCRIPT_BYTES) throw new ScriptError('tooLarge');
  const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
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
