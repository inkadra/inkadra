// SPDX-License-Identifier: MPL-2.0
import { createBoardDoc, MAX_STROKES, readElement, roots } from '@inkadra/doc-schema';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addTodoItem,
  type ClipboardData,
  copyElements,
  createElement,
  deleteElements,
  listElements,
  PasteRefusedError,
  pasteElements,
  updateElement,
} from './board.ts';
import { addStroke } from './film.ts';
import { addPlanIcon, addVariant, type PlanElement } from './plan.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const otherBoard = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
const opts = { userId: null };
const at = { x: 0, y: 0 };
const through = (data: unknown): ClipboardData => JSON.parse(JSON.stringify(data));

/** Every card of a board as stored, its ids by position, without the time it was pasted. */
function contents(doc: Y.Doc) {
  const ids = [...roots(doc).elements.keys()];
  return [...roots(doc).elements.values()].map((map) => {
    const { createdAt: _, ...json } = map.toJSON();
    let text = JSON.stringify(json);
    ids.forEach((id, i) => {
      text = text.replaceAll(id, `#${i}`);
    });
    return JSON.parse(text);
  });
}

describe('pasting a card that does not validate (a link written before http(s) only)', () => {
  function columnWithOldLink() {
    const doc = createBoardDoc(boardId);
    const column = createElement(doc, 'column', at, { title: 'Riferimenti' }, opts).id;
    const note = createElement(doc, 'note', at, { parent: column }, opts).id;
    const link = createElement(doc, 'link', at, { parent: column, url: 'https://a.example' }, opts);
    roots(doc).elements.get(link.id)?.set('url', 'mailto:regia@example.com');
    return { doc, column, note };
  }

  it('pastes the column and the valid cards, and counts the one left out', () => {
    const { doc, column } = columnWithOldLink();
    const target = createBoardDoc(otherBoard);
    const result = pasteElements(target, through(copyElements(doc, [column])), at, opts);
    expect(result.ids).toHaveLength(1);
    expect(result.skipped).toBe(1);
    const pasted = listElements(target);
    expect(pasted.map((e) => e.type).sort()).toEqual(['column', 'note']);
    expect(pasted.find((e) => e.type === 'note')?.parent).toBe(result.ids[0]);
  });
});

describe('a crafted clipboard is checked before anything is written', () => {
  function variantClipboard() {
    const doc = createBoardDoc(boardId);
    const plan = createElement(doc, 'plan', at, {}, opts).id;
    const read = listElements(doc).find((e) => e.id === plan) as PlanElement;
    const variant = addVariant(doc, read, 'Sera', opts);
    const note = createElement(doc, 'note', { x: 300, y: 0 }, {}, opts).id;
    // Pasted on another board, the variant takes its base's Set from the clipboard.
    return { data: through(copyElements(doc, [note, variant])), variant };
  }
  const stroke = { id: 'strokeAAAAAA', tool: 'pencil', color: '#202020', width: 2, points: [0, 0] };

  it.each([
    ['too many strokes', { strokes: Array.from({ length: MAX_STROKES + 1 }, () => stroke) }],
    ['a list of the wrong type', { icons: 5 }],
    ['an item that is not an object', { strokes: ['x'] }],
    ['a scale of the wrong type', { scale: 'x' }],
    ['a grid it does not know', { scale: 100, grid: '3' }],
  ])('refuses a base with %s and writes nothing', (_, fields) => {
    const { data, variant } = variantClipboard();
    data.planBases = { [variant]: { strokes: [], shapes: [], icons: [], ...fields } as never };
    const target = createBoardDoc(otherBoard);
    expect(() => pasteElements(target, data, at, opts)).toThrow(new PasteRefusedError('invalid'));
    expect(roots(target).elements.size).toBe(0);
  });

  it('pastes a variant whose base is nowhere as a plan of its own', () => {
    const { data } = variantClipboard();
    delete data.planBases;
    const target = createBoardDoc(otherBoard);
    pasteElements(target, data, at, opts);
    const plan = listElements(target).find((e) => e.type === 'plan') as PlanElement;
    expect(plan.variantOf).toBeUndefined();
  });

  it.each([
    [
      'an element that does not validate',
      (d: ClipboardData) => ({ ...d, elements: [...d.elements, { id: 'x' }] }),
    ],
    [
      'an element that is not an object',
      (d: ClipboardData) => ({ ...d, elements: [...d.elements, 5] }),
    ],
    ['cards that do not decode', (d: ClipboardData) => ({ ...d, cards: { abc: 'not base64!' } })],
    ['cards of the wrong type', (d: ClipboardData) => ({ ...d, cards: 'x' })],
    ['elements of the wrong type', (d: ClipboardData) => ({ ...d, elements: {} })],
  ])('refuses %s and writes nothing', (_, craft) => {
    const { data } = variantClipboard();
    const target = createBoardDoc(otherBoard);
    expect(() => pasteElements(target, craft(data) as never, at, opts)).toThrow(PasteRefusedError);
    expect(roots(target).elements.size).toBe(0);
  });

  it('refuses a card of a newer schema stored otherwise than this build stores it', () => {
    const doc = createBoardDoc(boardId);
    roots(doc).meta.set('schemaVersion', 999);
    const arrow = createElement(
      doc,
      'arrow',
      at,
      { from: { x: 0, y: 0 }, to: { x: 9, y: 9 } },
      opts,
    );
    const map = roots(doc).elements.get(arrow.id) as Y.Map<unknown>;
    map.set('from', new Y.Map<unknown>(Object.entries({ x: 0, y: 0 })));
    map.set('curve', 0.5);
    const target = createBoardDoc(boardId);
    expect(() => pasteElements(target, through(copyElements(doc, [arrow.id])), at, opts)).toThrow(
      new PasteRefusedError('newer'),
    );
    expect(roots(target).elements.size).toBe(0);
  });
});

describe('the clipboard of builds before and after decision 0101', () => {
  /** Known content of every kind a paste relinks: note body, attached arrow, scene, variant. */
  function knownBoard() {
    const doc = createBoardDoc(boardId);
    const note = createElement(doc, 'note', at, {}, opts).id;
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Esterno giorno')]);
    (roots(doc).elements.get(note)!.get('body') as Y.XmlFragment).insert(0, [p]);
    const arrow = createElement(
      doc,
      'arrow',
      { x: 10, y: 10 },
      { from: { x: 0, y: 0, elementId: note }, to: { x: 50, y: 50 } },
      opts,
    ).id;
    const scene = createElement(
      doc,
      'scene',
      { x: 400, y: 0 },
      { number: '2', title: '' },
      opts,
    ).id;
    const todo = createElement(doc, 'todo', at, { items: [], parent: scene }, opts).id;
    addTodoItem(doc, todo, 'Ombrello');
    updateElement(doc, todo, { list: 'props', sceneId: scene });
    const plan = createElement(doc, 'plan', { x: 0, y: 400 }, {}, opts).id;
    addPlanIcon(doc, plan, { kind: 'sofa', color: '#202020', x: 10, y: 10 });
    const variant = addVariant(
      doc,
      listElements(doc).find((e) => e.id === plan) as PlanElement,
      'B',
      opts,
    );
    const frame = createElement(doc, 'frame', { x: 800, y: 0 }, {}, opts).id;
    addStroke(doc, frame, { tool: 'pencil', color: '#202020', width: 2, points: [0, 0, 9, 9] });
    return { doc, ids: [note, arrow, scene, variant, frame] };
  }

  it('carries known cards as elements only, and pastes the same with or without the new fields', () => {
    const { doc, ids } = knownBoard();
    const data = through(copyElements(doc, ids));
    expect(data.cards).toBeUndefined();
    expect(data.source).toMatchObject({ boardId, schemaVersion: expect.any(Number) });
    // An older build reads only version, elements, bodies and planBases.
    const older = {
      version: data.version,
      elements: data.elements,
      bodies: data.bodies,
      planBases: data.planBases,
    };
    const viaNew = createBoardDoc(otherBoard);
    const viaOld = createBoardDoc(otherBoard);
    pasteElements(viaNew, data, at, opts);
    pasteElements(viaOld, older as ClipboardData, at, opts);
    expect(contents(viaNew)).toEqual(contents(viaOld));
    expect(contents(viaNew)).toHaveLength(6);
    for (const map of roots(viaNew).elements.values()) expect(readElement(map)).not.toBeNull();
  });

  it('carries a card that does not validate only as stored, for the count', () => {
    const doc = createBoardDoc(boardId);
    const link = createElement(doc, 'link', at, { url: 'https://a.example' }, opts).id;
    roots(doc).elements.get(link)?.set('url', 'mailto:a@example.com');
    const data = copyElements(doc, [link]);
    expect(data.elements).toEqual([]);
    expect(Object.keys(data.cards ?? {})).toEqual([link]);
    expect(pasteElements(createBoardDoc(boardId), through(data), at, opts)).toEqual({
      ids: [],
      skipped: 1,
    });
  });
});

it('drops the base link of a variant whose base is not a plan, taking nothing from it', () => {
  const doc = createBoardDoc(boardId);
  const frame = createElement(doc, 'frame', at, {}, opts).id;
  addStroke(doc, frame, { tool: 'pencil', color: '#202020', width: 2, points: [0, 0, 5, 5] });
  const plan = createElement(doc, 'plan', at, {}, opts).id;
  roots(doc).elements.get(plan)?.set('variantOf', frame);
  deleteElements(doc, [frame]);
  const map = roots(doc).elements.get(plan) as Y.Map<unknown>;
  expect((map.get('strokes') as Y.Array<unknown>).length).toBe(0);
  expect(map.has('variantOf')).toBe(false);
});
