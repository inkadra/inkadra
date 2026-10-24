import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoff, createPoller, type PollOutcome } from './poller.ts';

const INTERVAL = 5000;
const MAX = 60_000;

/** A request the test answers when it wants, to see what the poller does meanwhile. */
function controlled() {
  const calls: Array<{ signal: AbortSignal; answer: (o: PollOutcome) => void }> = [];
  const run = vi.fn(
    (signal: AbortSignal) =>
      new Promise<PollOutcome>((resolve) => {
        calls.push({ signal, answer: resolve });
      }),
  );
  return { run, calls };
}

/** Lets the poller see an answer (its continuation is a microtask). */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('backoff', () => {
  it('doubles the wait after each failure, up to the cap', () => {
    expect(backoff(0, INTERVAL, MAX)).toBe(5000);
    expect(backoff(1, INTERVAL, MAX)).toBe(10_000);
    expect(backoff(2, INTERVAL, MAX)).toBe(20_000);
    expect(backoff(3, INTERVAL, MAX)).toBe(40_000);
    expect(backoff(4, INTERVAL, MAX)).toBe(60_000);
    expect(backoff(10, INTERVAL, MAX)).toBe(60_000);
  });
});

describe('guest polling', () => {
  let hidden = false;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = (run: (s: AbortSignal) => Promise<PollOutcome>) =>
    createPoller({ run, interval: INTERVAL, max: MAX, hidden: () => hidden, now: Date.now });

  it('asks every interval while all is well', async () => {
    const run = vi.fn(async (): Promise<PollOutcome> => ({ kind: 'ok' }));
    const p = make(run);
    p.start();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(run).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it('backs off after failures and resets after a success', async () => {
    const answers: PollOutcome[] = [
      { kind: 'retry' },
      { kind: 'retry' },
      { kind: 'retry' },
      { kind: 'ok' },
      { kind: 'ok' },
    ];
    const run = vi.fn(async (): Promise<PollOutcome> => answers.shift() ?? { kind: 'ok' });
    const p = make(run);
    p.start();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000 - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(run).toHaveBeenCalledTimes(4);
    // That one worked: back to the normal interval.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(run).toHaveBeenCalledTimes(5);
    p.stop();
  });

  it('treats a thrown error like a failure', async () => {
    const run = vi
      .fn<(s: AbortSignal) => Promise<PollOutcome>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ kind: 'ok' });
    const p = make(run);
    p.start();
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('honours Retry-After, even against focus', async () => {
    const answers: PollOutcome[] = [{ kind: 'retry', after: 120_000 }];
    const run = vi.fn(async (): Promise<PollOutcome> => answers.shift() ?? { kind: 'ok' });
    const p = make(run);
    p.start();
    await settle();
    p.poke();
    await vi.advanceTimersByTimeAsync(119_999);
    p.poke();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('never sends a second request while one is in flight', async () => {
    const { run, calls } = controlled();
    const p = make(run);
    p.start();
    await settle();
    // Focus and visibilitychange fire together when the guest comes back.
    p.poke();
    p.poke();
    await vi.advanceTimersByTimeAsync(MAX);
    expect(run).toHaveBeenCalledTimes(1);
    calls[0]?.answer({ kind: 'ok' });
    await settle();
    p.poke();
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('asks once more after an action of the guest that came during a request', async () => {
    const { run, calls } = controlled();
    const p = make(run);
    p.start();
    await settle();
    p.poke({ force: true });
    p.poke({ force: true });
    expect(run).toHaveBeenCalledTimes(1);
    calls[0]?.answer({ kind: 'ok' });
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    calls[1]?.answer({ kind: 'ok' });
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('aborts the request in flight when stopped, and asks nothing after', async () => {
    const { run, calls } = controlled();
    const p = make(run);
    p.start();
    await settle();
    p.stop();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.answer({ kind: 'ok' });
    await vi.advanceTimersByTimeAsync(MAX);
    p.poke();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('pauses while the page is hidden and asks when it shows again', async () => {
    const run = vi.fn(async (): Promise<PollOutcome> => ({ kind: 'ok' }));
    const p = make(run);
    p.start();
    await settle();
    hidden = true;
    p.poke();
    await vi.advanceTimersByTimeAsync(10 * INTERVAL);
    expect(run).toHaveBeenCalledTimes(1);
    hidden = false;
    p.poke();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(run).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it('waits out Retry-After that ran while hidden before asking again', async () => {
    const answers: PollOutcome[] = [{ kind: 'retry', after: 30_000 }];
    const run = vi.fn(async (): Promise<PollOutcome> => answers.shift() ?? { kind: 'ok' });
    const p = make(run);
    p.start();
    await settle();
    hidden = true;
    await vi.advanceTimersByTimeAsync(30_000);
    hidden = false;
    p.poke();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('stops for good on done', async () => {
    const run = vi.fn(async (): Promise<PollOutcome> => ({ kind: 'done' }));
    const p = make(run);
    p.start();
    await vi.advanceTimersByTimeAsync(MAX);
    expect(run).toHaveBeenCalledTimes(1);
    p.stop();
  });
});
