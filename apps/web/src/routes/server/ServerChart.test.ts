import { expect, it } from 'vitest';
import { markerLabels, segments, textWidth, tickGutter } from './ServerChart.tsx';

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

it('keeps nearby event labels disjoint at phone and desktop widths', () => {
  const markers = [0, 1, 2, 90, 100].map((t) => ({
    t: new Date(t).toISOString(),
    label: '2 videos converted',
  }));
  for (const width of [200, 390, 1280]) {
    const labels = markerLabels(markers, (ms) => 46 + (ms / 100) * (width - 52), 46, width - 6);
    expect(labels.length).toBeLessThan(markers.length);
    labels.forEach((label, i) => {
      expect(label.x).toBeGreaterThanOrEqual(46);
      expect(label.x + label.width).toBeLessThanOrEqual(width - 6);
      if (i)
        expect(label.x).toBeGreaterThanOrEqual(
          (labels[i - 1]?.x ?? 0) + (labels[i - 1]?.width ?? 0) + 8,
        );
    });
  }
});

it('reserves room for the widest tick label', () => {
  expect(tickGutter(['0', '20 s'])).toBe(46);
  expect(tickGutter(['0', '500 ms', '1,500 Mb/s'])).toBe(textWidth('1,500 Mb/s') + 6);
});
