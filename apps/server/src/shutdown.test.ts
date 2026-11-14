import pino from 'pino';
import { expect, it } from 'vitest';
import { closeAll, settledWithin, shutdownOnce } from './shutdown.ts';

const log = pino({ level: 'silent' });

it('runs every closer in order, past one that fails', async () => {
  const seen: string[] = [];
  const done = await closeAll(
    [
      async () => seen.push('collab'),
      async () => {
        throw new Error('boom');
      },
      async () => seen.push('db'),
    ],
    log,
  );
  expect(done).toBe(true);
  expect(seen).toEqual(['collab', 'db']);
});

it('gives up at the deadline on a closer that never ends (#796)', async () => {
  expect(await closeAll([() => new Promise(() => {})], log, 20)).toBe(false);
  expect(await settledWithin(new Promise(() => {}), 10)).toBe(false);
});

it('shuts down once, and only when startup is over', async () => {
  const runs: string[] = [];
  const stop = shutdownOnce(async (reason) => {
    runs.push(reason);
  });
  stop.request('lease lost'); // during startup: waits
  expect(runs).toEqual([]);
  stop.ready();
  stop.request('SIGTERM'); // a second ask while stopping: ignored
  stop.ready();
  expect(runs).toEqual(['lease lost']);
});
