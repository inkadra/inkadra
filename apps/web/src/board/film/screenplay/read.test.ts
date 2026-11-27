import { afterEach, expect, it, vi } from 'vitest';
import { detectScreenplay, readScreenplay } from './parse.ts';
import { ScriptError } from './script.ts';

const terminate = vi.fn();
const postMessage = vi.fn();
type FakeWorker = {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
};
let worker: FakeWorker;
const workers: FakeWorker[] = [];
vi.stubGlobal(
  'Worker',
  class {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    constructor() {
      worker = this;
      workers.push(this);
    }
    postMessage = postMessage;
    terminate = terminate;
  },
);
const file = { name: 'x.fountain', size: 1 } as File;
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  workers.length = 0;
});
it('terminates a malicious or stalled parser at its deadline', async () => {
  vi.useFakeTimers();
  const result = readScreenplay({ name: 'x.fountain', size: 1 } as File);
  const assertion = expect(result).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(10_000);
  await assertion;
  expect(terminate).toHaveBeenCalledOnce();
});
it('surfaces a missing text layer and always disposes the worker', async () => {
  const result = readScreenplay({ name: 'x.fountain', size: 1 } as File);
  worker.onmessage?.({ data: { kind: 'screenplay', error: 'noText' } });
  await expect(result).rejects.toThrow('noText');
  expect(terminate).toHaveBeenCalledOnce();
});
it('checks the byte cap before creating a worker', async () => {
  await expect(readScreenplay({ size: 5 * 1024 * 1024 + 1 } as File)).rejects.toThrow('tooLarge');
  expect(terminate).not.toHaveBeenCalled();
});
it('ignores pdf.js control messages until the screenplay response', async () => {
  const result = readScreenplay({ name: 'x.fountain', size: 1 } as File);
  worker.onmessage?.({ data: { action: 'ready' } });
  expect(terminate).not.toHaveBeenCalled();
  worker.onmessage?.({ data: { kind: 'screenplay', error: 'invalid' } });
  await expect(result).rejects.toThrow('invalid');
  expect(terminate).toHaveBeenCalledOnce();
});
it('resolves the parsed script and disposes the worker', async () => {
  const script = { title: 'X', characters: [], scenes: [] };
  const result = readScreenplay({ name: 'x.fdx', size: 1 } as File);
  worker.onmessage?.({ data: { kind: 'screenplay', script } });
  await expect(result).resolves.toEqual(script);
  expect(terminate).toHaveBeenCalledOnce();
});
it('a .txt dropped on a board is read in the worker; a stalled one stays a file card', async () => {
  vi.useFakeTimers();
  const text = vi.fn();
  const result = detectScreenplay({ name: 'notes.txt', size: 1, text } as unknown as File);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await result).toBeNull();
  expect(text).not.toHaveBeenCalled();
  expect(terminate).toHaveBeenCalledOnce();
});
it('ignores empty messages and rejects a reply that cannot be cloned', async () => {
  const result = readScreenplay(file);
  worker.onmessage?.({ data: null });
  worker.onmessageerror?.();
  await expect(result).rejects.toThrow('invalid');
  expect(terminate).toHaveBeenCalledOnce();
});
it('disposes the worker when posting the file throws', async () => {
  vi.useFakeTimers();
  postMessage.mockImplementationOnce(() => {
    throw new DOMException('DataCloneError');
  });
  await expect(readScreenplay(file)).rejects.toThrow();
  expect(terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('an unreadable file is a read error, not an invalid script', async () => {
  const result = readScreenplay(file);
  worker.onmessage?.({ data: { kind: 'screenplay', error: 'read' } });
  const error = await result.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(ScriptError);
});
it('runs two workers at once; a queued read starts its deadline with its own worker', async () => {
  vi.useFakeTimers();
  const reads = [readScreenplay(file), readScreenplay(file), readScreenplay(file)];
  const settled = reads.map((read) => read.catch((e: Error) => e.message));
  expect(workers).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(9_000);
  workers[0]?.onmessage?.({ data: { kind: 'screenplay', error: 'empty' } });
  await vi.advanceTimersByTimeAsync(0);
  expect(workers).toHaveLength(3);
  // The second times out at 10 s; the third, started at 9 s, still runs.
  await vi.advanceTimersByTimeAsync(9_000);
  expect(await settled[1]).toBe('timeout');
  workers[2]?.onmessage?.({ data: { kind: 'screenplay', error: 'noText' } });
  expect(await Promise.all(settled)).toEqual(['empty', 'timeout', 'noText']);
  expect(terminate).toHaveBeenCalledTimes(3);
});
