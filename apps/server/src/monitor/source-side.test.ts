import { expect, it } from 'vitest';
import { sourceSide } from './status.ts';

it('names landscape and portrait sources by their real shorter side', () => {
  expect(sourceSide({ width: 3840, height: 2160 })).toBe(2160);
  expect(sourceSide({ width: 2160, height: 3840 })).toBe(2160);
  expect(sourceSide({ width: null, height: null })).toBeNull();
});
