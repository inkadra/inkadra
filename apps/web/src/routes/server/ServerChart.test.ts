import { expect, it } from 'vitest';
import { segments } from './ServerChart.tsx';

it('breaks the line where values are missing or no sample came for a while', () => {
  const at = [0, 10, 20, 60, 70];
  const lines = segments(
    [1, 2, null, 4, 5],
    at,
    25,
    (i) => at[i] ?? 0,
    (v) => v,
  );
  expect(lines).toEqual([
    ['0.0,1.0', '10.0,2.0'],
    ['60.0,4.0', '70.0,5.0'],
  ]);
  // 40 s without a sample split a line of known values too.
  expect(
    segments(
      [1, 2, 3],
      [0, 10, 50],
      25,
      (i) => i,
      (v) => v,
    ),
  ).toHaveLength(2);
});
