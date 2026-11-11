// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addElement,
  CardColor,
  createBoardDoc,
  Element,
  MAX_STROKE_POINTS,
  MAX_STROKES,
  migrateBoardDoc,
  readElement,
  roots,
  STROKE_GRID,
  toGuestElement,
  validateBoardDoc,
} from './index.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const base = {
  id: 'contextAAAAA',
  x: 0,
  y: 0,
  w: 240,
  z: 'a0',
  parent: null,
  createdBy: null,
  createdAt: 0,
};
const stroke = {
  id: 'strokeAAAAAA',
  tool: 'pencil' as const,
  color: '#123456',
  width: 10,
  points: [0, 0, STROKE_GRID, STROKE_GRID],
};
const cards = [
  {
    ...base,
    type: 'section',
    title: 'Act II',
    size: 'M',
    bold: true,
    italic: true,
    align: 'center',
    color: 'orange',
    background: 'black',
    line: false,
  },
  {
    ...base,
    type: 'link',
    url: 'https://example.com',
    title: 'Reference',
    showInfo: false,
    showPreview: true,
  },
  { ...base, type: 'file', assetId: 'video', showPreview: false },
  { ...base, type: 'image', assetId: 'photo', strokes: [stroke] },
].map((card) => Element.parse(card));

describe('contextual appearance contract', () => {
  it.each(cards)('preserves $type through Yjs, JSON export/import and guest projection', (card) => {
    const doc = createBoardDoc(boardId);
    addElement(doc, card);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    expect(readElement(roots(restored).elements.get(card.id)!)).toEqual(card);
    const json = Element.parse(JSON.parse(JSON.stringify(card)));
    const imported = createBoardDoc(boardId);
    addElement(imported, json);
    expect(readElement(roots(imported).elements.get(card.id)!)).toEqual(card);
    expect(Element.parse(toGuestElement(card))).toEqual(card);
    expect(validateBoardDoc(restored)).toEqual([]);
  });

  it.each(['blue', 'orange', 'purple', 'green', 'teal', 'yellow', 'red', 'pink'])(
    'preserves section accent %s without widening card colours',
    (color) => {
      const section = Element.parse({ ...cards[0], color });
      const doc = createBoardDoc(boardId);
      addElement(doc, section);
      expect(readElement(roots(doc).elements.get(section.id)!)).toEqual(section);
      expect(Element.parse(toGuestElement(section))).toEqual(section);
      if (!['blue', 'orange', 'purple', 'green'].includes(color)) {
        expect(CardColor.safeParse(color).success).toBe(false);
      }
    },
  );

  it('upgrades version 15 without materialising defaults or changing elements', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 15);
    const old = [
      { ...base, id: 'sectionAAAAA', type: 'section', title: 'Old heading' },
      { ...base, id: 'linkAAAAAAAA', type: 'link', url: 'https://example.com' },
      { ...base, id: 'fileAAAAAAAA', type: 'file', assetId: 'video' },
      { ...base, id: 'imageAAAAAAA', type: 'image', assetId: 'photo' },
    ].map((card) => Element.parse(card));
    for (const card of old) addElement(doc, card);
    const before = roots(doc).elements.toJSON();
    expect(migrateBoardDoc(doc, boardId)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(roots(doc).elements.toJSON()).toEqual(before);
    expect([...roots(doc).elements.values()].map(readElement)).toEqual(old);
    expect(migrateBoardDoc(doc, boardId)).toEqual([]);
  });

  it('validates independent link switches and rejects invalid appearance values', () => {
    const link = cards[1]!;
    for (const showInfo of [true, false])
      for (const showPreview of [true, false]) {
        expect(Element.parse({ ...link, showInfo, showPreview })).toMatchObject({
          showInfo,
          showPreview,
        });
      }
    for (const patch of [
      { size: 'XL' },
      { bold: 1 },
      { italic: 'yes' },
      { align: 'justify' },
      { color: '#123456' },
      { line: null },
    ]) {
      expect(Element.safeParse({ ...cards[0], ...patch }).success).toBe(false);
    }
    expect(Element.safeParse({ ...link, showInfo: 'false' }).success).toBe(false);
    expect(Element.safeParse({ ...cards[2], showPreview: 0 }).success).toBe(false);
  });

  it('enforces existing stroke bounds at the document trust boundary', () => {
    const doc = createBoardDoc(boardId);
    const image = addElement(doc, cards[3]!);
    expect(image.get('strokes')).toBeInstanceOf(Y.Array);
    for (const strokes of [
      Array(MAX_STROKES + 1).fill(stroke),
      [{ ...stroke, points: [0, STROKE_GRID + 1] }],
      [{ ...stroke, points: [0, 0, 1] }],
      [{ ...stroke, points: Array(MAX_STROKE_POINTS * 2 + 2).fill(0) }],
      [{ ...stroke, width: 201 }],
      [{ ...stroke, opacity: 0 }],
    ]) {
      image.set('strokes', Y.Array.from(strokes));
      expect(validateBoardDoc(doc)).toHaveLength(1);
    }
  });
});

it('upgrades old character cards without adding defaults or losing data', () => {
  const doc = createBoardDoc(boardId);
  roots(doc).meta.set('schemaVersion', 16);
  addElement(
    doc,
    Element.parse({
      ...base,
      type: 'character',
      name: 'Marta',
      contact: 'private',
      notes: 'Keep this',
    }),
  );
  const before = roots(doc).elements.toJSON();
  expect(migrateBoardDoc(doc, boardId)).toEqual([17, 18, 19, 20, 21, 22, 23, 24]);
  expect(roots(doc).elements.toJSON()).toEqual(before);
});
