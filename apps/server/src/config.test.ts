import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const base = {
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://unused',
  AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
};

describe('UPLOAD_MAX_SIZE', () => {
  it.each([
    ['1048576', 1048576],
    ['500MB', 500 * 1024 ** 2],
    ['20 GB', 20 * 1024 ** 3],
    ['2TiB', 2 * 1024 ** 4],
    ['1.5g', 1.5 * 1024 ** 3],
    ['0', 0],
  ])('reads %s', (value, bytes) => {
    expect(loadConfig({ ...base, UPLOAD_MAX_SIZE: value }).UPLOAD_MAX_SIZE).toBe(bytes);
  });

  it('defaults to 20GB and rejects nonsense', () => {
    expect(loadConfig(base).UPLOAD_MAX_SIZE).toBe(20 * 1024 ** 3);
    expect(() => loadConfig({ ...base, UPLOAD_MAX_SIZE: 'lots' })).toThrow(/UPLOAD_MAX_SIZE/);
  });
});
