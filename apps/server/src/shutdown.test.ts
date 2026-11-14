import pino from 'pino';
import { expect, it } from 'vitest';
import { closeAll, settledWithin } from './shutdown.ts';

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
