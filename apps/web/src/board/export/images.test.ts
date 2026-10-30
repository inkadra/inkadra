import { describe, expect, it } from 'vitest';
import { pool } from './images.ts';

describe('pool', () => {
  it('never runs more than the limit at once and runs everything', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await pool(
      Array.from({ length: 20 }, (_, i) => i),
      6,
      async (i) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1 + (i % 3)));
        running -= 1;
        done.push(i);
      },
    );
    expect(peak).toBe(6);
    expect(done.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    let started = 0;
    const run = pool(
      Array.from({ length: 50 }, (_, i) => i),
      2,
      async () => {
        started += 1;
        if (started === 3) controller.abort();
        await new Promise((r) => setTimeout(r, 1));
      },
      controller.signal,
    );
    await expect(run).rejects.toThrow();
    expect(started).toBeLessThan(10);
  });
});
