import { describe, expect, it, vi } from 'vitest';
import { SOFTWARE_ENCODER, type VideoEncoder } from './hwaccel.ts';
import { runAttempts } from './proxy.ts';
import { ProxyTimeout } from './video.ts';

const qsv: VideoEncoder = { backend: 'qsv', device: '/dev/dri/renderD128', label: 'QSV' };
const HOUR = 60 * 60 * 1000;

/** A clock the attempts move forward, and the timeouts each attempt was given. */
function harness(steps: Array<{ takesMs: number; fails?: 'error' | 'timeout' }>) {
  let clock = 0;
  const given: number[] = [];
  const touch = vi.fn(async () => {});
  const onRetry = vi.fn(async () => {});
  const run = vi.fn(async (_encoder: VideoEncoder | null, timeoutMs: number) => {
    const step = steps[given.length];
    given.push(timeoutMs);
    if (!step) throw new Error('unexpected attempt');
    // A run never lasts past the time it was given: ffmpeg is killed there.
    clock += Math.min(step.takesMs, timeoutMs);
    if (step.fails === 'timeout' || step.takesMs > timeoutMs) throw new ProxyTimeout('timeout');
    if (step.fails === 'error') throw new Error('GPU refused the file');
  });
  return { given, touch, onRetry, run, now: () => clock };
}

describe('runAttempts', () => {
  const retries = [{ ...qsv, cpuDecode: true }, SOFTWARE_ENCODER];

  it('shares one deadline: each attempt gets the time left', async () => {
    const h = harness([
      { takesMs: HOUR, fails: 'error' },
      { takesMs: 30 * 60_000, fails: 'error' },
      { takesMs: 10 * 60_000 },
    ]);
    const used = await runAttempts({ first: qsv, retries, totalMs: 4 * HOUR, ...h });
    expect(used).toBe('software');
    expect(h.given).toEqual([4 * HOUR, 3 * HOUR, 2.5 * HOUR]);
    expect(h.touch).toHaveBeenCalledTimes(3);
    expect(h.onRetry).toHaveBeenCalledTimes(2);
    expect(h.run.mock.calls.map((c) => c[0]?.backend ?? 'settings')).toEqual([
      'settings',
      'qsv',
      'software',
    ]);
  });

  it('never retries after a timeout: a hung GPU costs the total at most', async () => {
    const h = harness([{ takesMs: 10 * HOUR }]);
    await expect(
      runAttempts({ first: qsv, retries, totalMs: 4 * HOUR, ...h }),
    ).rejects.toBeInstanceOf(ProxyTimeout);
    expect(h.given).toEqual([4 * HOUR]);
    expect(h.now()).toBe(4 * HOUR);
    expect(h.onRetry).not.toHaveBeenCalled();
  });

  it('starts no attempt once the deadline has passed', async () => {
    // The first attempt fails exactly at the deadline (an error, not a timeout).
    const h = harness([{ takesMs: 4 * HOUR, fails: 'error' }]);
    await expect(
      runAttempts({ first: qsv, retries, totalMs: 4 * HOUR, ...h }),
    ).rejects.toBeInstanceOf(ProxyTimeout);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.touch).toHaveBeenCalledTimes(1);
  });

  it('names what made the copy, and rethrows the last failure', async () => {
    const remux = harness([{ takesMs: 1000 }]);
    expect(await runAttempts({ first: null, retries: [], totalMs: HOUR, ...remux })).toBe('copy');
    const cpu = harness([{ takesMs: 1, fails: 'error' }, { takesMs: 1 }]);
    expect(await runAttempts({ first: qsv, retries, totalMs: HOUR, ...cpu })).toBe(
      'qsv+cpu-decode',
    );
    const software = harness([{ takesMs: 1, fails: 'error' }]);
    await expect(
      runAttempts({ first: SOFTWARE_ENCODER, retries: [], totalMs: HOUR, ...software }),
    ).rejects.toThrow('GPU refused the file');
  });
});
