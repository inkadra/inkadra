import { describe, expect, it } from 'vitest';
import { databaseError } from './errors.ts';

const wrapped = (code: string) =>
  new Error('Failed query', { cause: Object.assign(new Error('pg'), { code }) });

describe('databaseError', () => {
  it('answers races with 409 and outages with 503 and Retry-After', () => {
    expect(databaseError(wrapped('23505'))).toMatchObject({ code: 'conflict' });
    expect(databaseError(wrapped('40001'))).toMatchObject({ code: 'unavailable', retryAfter: 1 });
    expect(databaseError(wrapped('40P01'))).toMatchObject({ code: 'unavailable', retryAfter: 1 });
    expect(databaseError(wrapped('57014'))).toMatchObject({ code: 'unavailable', retryAfter: 1 });
    for (const code of ['ECONNREFUSED', 'CONNECTION_CLOSED', '57P01', '08006'])
      expect(databaseError(wrapped(code))).toMatchObject({ code: 'unavailable', retryAfter: 5 });
  });

  it('leaves bugs as they are', () => {
    expect(databaseError(wrapped('23503'))).toBeUndefined();
    expect(databaseError(new TypeError('x'))).toBeUndefined();
    expect(databaseError(undefined)).toBeUndefined();
  });
});
