// SPDX-License-Identifier: AGPL-3.0-only
import { addElement, createBoardDoc, Element, readElement, roots } from '@inkadra/doc-schema';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { readableElements } from './export.ts';
import { remapDoc } from './remap.ts';

it('preserves contextual fields in readable exports and remapped archive documents', () => {
  const board = '11111111-1111-4111-8111-111111111111';
  const doc = createBoardDoc(board);
  const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdBy: null, createdAt: 0 };
  const cards = [
    {
      ...base,
      id: 'sectionAAAAA',
      type: 'section',
      title: 'Act II',
      size: 'M',
      bold: true,
      italic: true,
      align: 'center',
      color: 'pink',
      line: false,
    },
    {
      ...base,
      id: 'linkAAAAAAAA',
      type: 'link',
      url: 'https://example.com',
      showInfo: false,
      showPreview: true,
    },
    { ...base, id: 'fileAAAAAAAA', type: 'file', assetId: 'video', showPreview: false },
    {
      ...base,
      id: 'imageAAAAAAA',
      type: 'image',
      assetId: 'photo',
      strokes: [
        {
          id: 'strokeAAAAAA',
          tool: 'pencil',
          color: '#123456',
          width: 10,
          points: [0, 0, 4096, 4096],
        },
      ],
    },
  ].map((card) => Element.parse(card));
  for (const card of cards) addElement(doc, card);
  expect(JSON.parse(JSON.stringify(readableElements(doc)))).toEqual(cards);
  const imported = new Y.Doc();
  Y.applyUpdate(imported, Y.encodeStateAsUpdate(doc));
  remapDoc(imported, board, {
    boards: new Map(),
    assets: new Map([
      ['video', 'new-video'],
      ['photo', 'new-photo'],
    ]),
    person: () => null,
  });
  for (const card of cards) {
    expect(readElement(roots(imported).elements.get(card.id)!)).toEqual(
      'assetId' in card ? { ...card, assetId: `new-${card.assetId}` } : card,
    );
  }
});
