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
  return inSlot(() => readInWorker(file));
}

/**
 * At most two workers at once: a drop of many .txt files queues rather than starting one each
 * (browsers cap workers per site, and phones run out of memory), and a queued read's deadline
 * starts only with its own worker.
 */
const MAX_WORKERS = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function inSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running < MAX_WORKERS) running++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await task();
  } finally {
    // The slot passes straight to the next read, or is freed.
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

type Reply = { kind?: string; script?: Script; error?: ScriptError['code'] | 'read' };

async function readInWorker(file: File): Promise<Script> {
  const worker = new Worker(new URL('./screenplay.worker.ts', import.meta.url), { type: 'module' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Script>((resolve, reject) => {
      timer = setTimeout(() => reject(new ScriptError('timeout')), 10_000);
      worker.onmessage = (event: MessageEvent<Reply | null>) => {
        const reply = event.data;
        if (reply?.kind !== 'screenplay') return;
        if (reply.script) resolve(reply.script);
        // Not a ScriptError: the dialog shows its "could not be read" message.
        else if (reply.error === 'read') reject(new Error('read'));
        else reject(new ScriptError(reply.error ?? 'invalid'));
      };
      worker.onerror = () => reject(new ScriptError('invalid'));
      worker.onmessageerror = () => reject(new ScriptError('invalid'));
      worker.postMessage(file);
    });
  } finally {
    clearTimeout(timer);
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
