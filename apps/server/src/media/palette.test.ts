import { describe, expect, it } from 'vitest';
import { palette } from './palette.ts';

const fill = (colours: Array<[number, number, number, number]>) =>
  Uint8Array.from(
    colours.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b]).flat()),
  );

describe('palette', () => {
  it('orders colours by their share of the image', () => {
    const rgb = fill([
      [255, 0, 0, 60],
      [0, 0, 255, 30],
      [255, 255, 255, 10],
    ]);
    expect(palette(rgb, 3)).toEqual(['#FF0000', '#0000FF', '#FFFFFF']);
  });

  it('returns one colour for a flat image and nothing for no pixels', () => {
    expect(palette(fill([[18, 52, 86, 100]]))).toEqual(['#123456']);
    expect(palette(new Uint8Array())).toEqual([]);
  });
});
