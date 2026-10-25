import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBusy, whenIdle } from '../pwa/busy.ts';
import { cancelUpload, retryUpload, startUpload } from './uploads.ts';

/**
 * A scripted double for `tus-js-client`'s Upload: each `start()` runs the next behaviour in
 * `script`, so the tests decide whether the request fails or succeeds.
 */
const { FakeUpload } = vi.hoisted(() => {
  class FakeUpload {
    static all: FakeUpload[] = [];
    // The tus options the upload was created with (onError, onSuccess, …).
    options: Record<string, (...args: unknown[]) => unknown> = {};
    script: Array<() => void> = [];
    starts = 0;
    aborted = false;
    constructor(_file: File, options: Record<string, (...args: unknown[]) => unknown>) {
      this.options = options;
      FakeUpload.all.push(this);
    }
    findPreviousUploads = () => Promise.resolve([]);
    resumeFromPreviousUpload = () => {};
    start = () => {
      this.starts += 1;
      const step = this.script.shift();
      step?.();
    };
    abort = () => {
      this.aborted = true;
      return Promise.resolve();
    };
  }
  return { FakeUpload };
});

vi.mock('tus-js-client', () => ({ Upload: FakeUpload }));

const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });

const start = ({ name, onFailed }: { name: string; onFailed?: () => void }) => {
  const key = startUpload({
    file: pdf(name),
    projectId: 'p1',
    boardId: 'b1',
    onAsset: vi.fn(),
    onFailed,
  });
  const upload = FakeUpload.all.at(-1)!;
  // The request fails once, while the browser still reports a network: tus gives up,
  // the item is failed and can be retried from memory.
  upload.script.push(() => upload.options.onError!());
  return { key, upload };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Lets the tus client act on a mocked response (its callbacks run in a microtask). */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('the reload guard and tus uploads', () => {
  it('holds it for a failed upload that can still be retried, and releases it on cancel', async () => {
    const onFailed = vi.fn();
    const { key, upload } = start({ name: 'failed.pdf', onFailed });
    await flush();
    expect(upload.starts).toBe(1);
    expect(onFailed).toHaveBeenCalledTimes(1);

    // The file is still in memory and "Retry" can use it: a reload for a new version would
    // lose it, so the update must wait for this upload like for a running one.
    expect(isBusy()).toBe(true);
    const release = vi.fn();
    whenIdle(release);
    expect(release).not.toHaveBeenCalled();

    // Explicit removal makes the upload non-retryable: the guard is released.
    cancelUpload(key);
    expect(upload.aborted).toBe(true);
    expect(isBusy()).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases it when the retry of a failed upload succeeds', async () => {
    const { key, upload } = start({ name: 'retry.pdf' });
    await flush();
    expect(isBusy()).toBe(true);

    upload.script.push(() => upload.options.onSuccess!());
    retryUpload(key);
    await flush();
    expect(upload.starts).toBe(2);
    expect(isBusy()).toBe(false);

    const release = vi.fn();
    whenIdle(release);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps holding it when the same file is added again to resume a failed upload', async () => {
    const { key, upload } = start({ name: 'again.pdf' });
    await flush();
    expect(isBusy()).toBe(true);

    // Dropping the same file again resumes the failed upload instead of starting another.
    const again = startUpload({
      file: pdf('again.pdf'),
      projectId: 'p1',
      boardId: 'b1',
      onAsset: vi.fn(),
    });
    expect(again).toBe(key);
    expect(FakeUpload.all.at(-1)).toBe(upload);
    expect(upload.starts).toBe(2);
    expect(isBusy()).toBe(true);

    cancelUpload(key);
    expect(isBusy()).toBe(false);
  });

  it('keeps holding it while an upload is still running, and releases it on cancel', async () => {
    const key = startUpload({
      file: pdf('running.pdf'),
      projectId: 'p1',
      boardId: 'b1',
      onAsset: vi.fn(),
    });
    const upload = FakeUpload.all.at(-1)!;
    await flush();
    expect(upload.starts).toBe(1);
    expect(isBusy()).toBe(true);

    const release = vi.fn();
    whenIdle(release);
    expect(release).not.toHaveBeenCalled();

    cancelUpload(key);
    expect(upload.aborted).toBe(true);
    expect(isBusy()).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
