import { createBoardDoc } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import { addPalette, hexToHsv, hexToRgb, hsvToHex, parseHex, rgbToHex } from './colors.ts';
import { BoardStore } from './store.ts';

it('converts between hex and RGB', () => {
  expect(hexToRgb('#2C3A2A')).toEqual([44, 58, 42]);
  expect(hexToRgb('#e3b98a')).toEqual([227, 185, 138]);
  expect(rgbToHex([200, 116, 46])).toBe('#C8742E');
  // Typed values are rounded and kept within 0-255.
  expect(rgbToHex([300, -4, 15.6])).toBe('#FF0010');
  expect(rgbToHex(hexToRgb('#0F1A1F'))).toBe('#0F1A1F');
  expect(parseHex(' c8742e ')).toBe('#C8742E');
  expect(parseHex('#C8742')).toBeNull();
  expect(parseHex('#GGGGGG')).toBeNull();
});

it('converts between hex and hue, saturation and value', () => {
  expect(hexToHsv('#FF0000')).toEqual([0, 1, 1]);
  expect(hexToHsv('#000000')).toEqual([0, 0, 0]);
  const [h, s, v] = hexToHsv('#C8742E');
  expect(Math.round(h)).toBe(27);
  expect(hsvToHex(h, s, v)).toBe('#C8742E');
  for (const hex of ['#2C3A2A', '#0F1A1F', '#E3B98A', '#808086', '#FFFFFF'])
    expect(hsvToHex(...hexToHsv(hex))).toBe(hex);
});

it('adds a palette as a row beside the image, in one undo step', () => {
  const store = new BoardStore(createBoardDoc('b1'));
  const palette = ['#C8742E', '#7A4A2A', '#E3B98A', '#2C3A2A', '#56664A', '#0F1A1F'];
  const ids = addPalette(store, { x: 100, y: 40, w: 240 }, palette, 'u1');
  const cards = ids.map((id) => store.getSnapshot().byId.get(id));
  expect(cards.map((c) => (c?.type === 'color' ? c.hex : null))).toEqual(palette);
  expect(cards.map((c) => c?.y)).toEqual(Array(6).fill(40));
  // Compact chips in a tight row right next to the image.
  expect(cards.map((c) => c?.x)).toEqual([356, 410, 464, 518, 572, 626]);
  expect(cards.every((c) => c?.w === 50)).toBe(true);
  store.undo.undo();
  expect(store.getSnapshot().byId.size).toBe(0);
});
