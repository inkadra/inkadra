import { expect, it, vi } from 'vitest';
import { queueErrors } from './queues.ts';

it('logs a queue connection error once a minute, without the driver message', () => {
  vi.useFakeTimers();
  const log = { warn: vi.fn() };
  const onError = queueErrors(log);
  const err = Object.assign(new Error('connect ECONNREFUSED redis://:secret@host'), {
    code: 'ECONNREFUSED',
  });
  onError('media')(err);
  onError('email')(err);
  expect(log.warn).toHaveBeenCalledTimes(1);
  expect(log.warn).toHaveBeenCalledWith(
    { queue: 'media', code: 'ECONNREFUSED' },
    'queue connection error',
  );
  vi.advanceTimersByTime(60_000);
  onError('email')(err);
  expect(log.warn).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
