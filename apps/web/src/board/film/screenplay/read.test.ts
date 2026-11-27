import { afterEach, expect, it, vi } from 'vitest';
import { detectScreenplay, readScreenplay } from './parse.ts';

const terminate = vi.fn();
let worker: { onmessage?: (event: { data: unknown }) => void; onerror?: () => void };
vi.stubGlobal(
  'Worker',
  class {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    constructor() {
      worker = this;
    }
    postMessage() {}
    terminate = terminate;
  },
);
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
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
