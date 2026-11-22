import { expect, it } from 'vitest';
import { serialPasses } from './collab.ts';

/** Access passes that each read the role once, at their start, and end when told to. */
function passes() {
  let role = 'viewer';
  const seen: string[] = [];
  const ends: Array<() => void> = [];
  const { join, fresh } = serialPasses(() => {
    seen.push(role);
    return new Promise<void>((resolve) => ends.push(resolve));
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    join,
    fresh,
    seen,
    flush,
    promote: () => {
      role = 'editor';
    },
    /** Ends the pass under way and lets the next one start. */
    end: async () => {
      ends.shift()?.();
      await flush();
    },
  };
}

it('runs one more pass after a change made while a pass had already read the old role', async () => {
  const p = passes();
  void p.join();
  expect(p.seen).toEqual(['viewer']);
  p.promote();
  const done = p.fresh();
  // A second change before that pass starts shares it.
  const same = p.fresh();
  expect(same).toBe(done);
  await p.flush();
  // The pass under way read the old role: the next one waits for it, never overlaps it.
  expect(p.seen).toEqual(['viewer']);
  await p.end();
  expect(p.seen).toEqual(['viewer', 'editor']);
  let settled = false;
  void done.then(() => {
    settled = true;
  });
  await p.flush();
  expect(settled).toBe(false);
  await p.end();
  expect(settled).toBe(true);
  // Nothing left running: the next change starts its pass at once.
  void p.fresh();
  expect(p.seen).toEqual(['viewer', 'editor', 'editor']);
});

it('lets a periodic tick join the pass under way instead of starting another', async () => {
  const p = passes();
  const first = p.join();
  expect(p.join()).toBe(first);
  expect(p.seen).toEqual(['viewer']);
  await p.end();
  await first;
});

it('still runs the next pass when the one under way fails', async () => {
  let started = 0;
  let fail: (() => void) | undefined;
  const { fresh, join } = serialPasses(() => {
    started++;
    return started === 1
      ? new Promise<void>((_, reject) => {
          fail = () => reject(new Error('database gone'));
        })
      : Promise.resolve();
  });
  void join().catch(() => {});
  const next = fresh();
  fail?.();
  await expect(next).resolves.toBeUndefined();
  expect(started).toBe(2);
});
