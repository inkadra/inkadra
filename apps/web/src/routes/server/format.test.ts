import { expect, it } from 'vitest';
import { duration, loadVerdict, niceMax, speedVerdict, storageVerdict } from './format.ts';

const storage = {
  driver: 'local' as const,
  location: '/data',
  total: 1000e9,
  free: 500e9,
  used: 500e9,
  originals: 300e9,
  copies: 50e9,
  previews: 10e9,
  growthPerMonth: 50e9,
  monthsLeft: 10,
};

it('reads load, speed and space in plain words', () => {
  expect([loadVerdict(0.3), loadVerdict(0.7), loadVerdict(0.9)]).toEqual(['ok', 'busy', 'high']);
  expect([speedVerdict(null), speedVerdict(120), speedVerdict(800), speedVerdict(3000)]).toEqual([
    'idle',
    'fast',
    'slow',
    'verySlow',
  ]);
  expect(storageVerdict(storage)).toEqual({ key: 'months', months: 10 });
  expect(storageVerdict({ ...storage, monthsLeft: 40 })).toEqual({ key: 'years' });
  expect(storageVerdict({ ...storage, free: 40e9 })).toEqual({ key: 'almostFull' });
  // S3: no total, so nothing about what is left.
  expect(
    storageVerdict({ ...storage, driver: 's3', total: null, free: null, monthsLeft: null }),
  ).toEqual({ key: 'unknown' });
});

it('says how long in the largest unit that fits', () => {
  expect(duration(6 * 86_400_000 + 3_600_000, 'en')).toBe('6 days');
  expect(duration(5 * 3_600_000, 'en')).toBe('5 hours');
  expect(duration(12 * 60_000, 'en')).toBe('12 minutes');
  expect(duration(40_000, 'en')).toBe('40 seconds');
  expect([niceMax(0), niceMax(3.2), niceMax(180), niceMax(4e9)]).toEqual([1, 5, 200, 5e9]);
});
