// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElement, createBoardDoc, roots, tableRowMap } from './doc.ts';
import { type Element, PLAN_ICON_KINDS } from './elements.ts';
import { generateReferenceBoard } from './reference-board.ts';
import { checkCard, checkNoteBody, type ForeignIssue, isForeignCard } from './strict.ts';

const boardId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const base = { x: 0, y: 0, w: 240, z: 'a0', parent: null, createdBy: null, createdAt: 0 };
let n = 0;
const nextId = () => `card${String(n++).padStart(9, 'A')}`;

function add(doc: Y.Doc, fields: Record<string, unknown>): Y.Map<unknown> {
  return addElement(doc, { ...base, id: nextId(), ...fields } as Element);
}

const issues = (map: Y.Map<unknown>): ForeignIssue[] => {
  const compat = checkCard(map);
  return compat.status === 'foreign' ? compat.issues : [];
};

describe('the strict check of a card', () => {
  it('knows every card of the reference board, rich notes and drawn plans included', {
    timeout: 30_000,
  }, () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, generateReferenceBoard('small', 7).update);
    const foreign = [...roots(doc).elements.values()].filter(isForeignCard);
    expect(foreign.map((map) => [map.get('type'), issues(map)])).toEqual([]);
  });

  it('finds fields it does not know at any depth', () => {
    const doc = createBoardDoc(boardId);
    const note = add(doc, { type: 'note' });
    note.set('pinned', true);
    expect(issues(note)).toEqual([{ kind: 'key', path: ['pinned'] }]);

    // addElement strips what it does not know: the newer fields are written as stored.
    const arrow = add(doc, { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    arrow.set('from', { x: 0, y: 0, side: 'left' });
    expect(issues(arrow)).toEqual([{ kind: 'key', path: ['from', 'side'] }]);

    const image = add(doc, { type: 'image', assetId: 'a' });
    image.set('crop', { x: 0, y: 0, w: 1, h: 1, feather: 0.2 });
    expect(issues(image)).toEqual([{ kind: 'key', path: ['crop', 'feather'] }]);

    const table = add(doc, { type: 'table', columns: [{ id: 'colAAAAAAAAA' }], rows: [] });
    const row = tableRowMap({ id: 'rowAAAAAAAAA', cells: { colAAAAAAAAA: 'Uno' } });
    row.set('height', 40);
    (table.get('rows') as Y.Array<Y.Map<unknown>>).push([row]);
    expect(issues(table)).toEqual([{ kind: 'key', path: ['rows', 0, 'height'] }]);

    const todo = add(doc, {
      type: 'todo',
      items: [{ id: 'itemAAAAAAAA', text: 'x', done: false }],
    });
    (todo.get('items') as Y.Array<Y.Map<unknown>>).get(0).set('priority', 'high');
    expect(issues(todo)).toEqual([{ kind: 'key', path: ['items', 0, 'priority'] }]);

    const plan = add(doc, { type: 'plan' });
    const icon = new Y.Map<unknown>(
      Object.entries({
        id: 'iconAAAAAAAA',
        kind: 'camera',
        color: '#202020',
        x: 10,
        y: 10,
        steps: [{ x: 1, y: 1, speed: 2 }],
        elevation: 2,
      }),
    );
    (plan.get('icons') as Y.Array<unknown>).push([icon]);
    expect(issues(plan)).toEqual([
      { kind: 'key', path: ['icons', 0, 'steps', 0, 'speed'] },
      { kind: 'key', path: ['icons', 0, 'elevation'] },
    ]);

    const frame = add(doc, { type: 'frame' });
    (frame.get('strokes') as Y.Array<unknown>).push([
      { id: 'strokeAAAAAA', tool: 'pencil', color: '#202020', width: 2, points: [0, 0], taper: 1 },
    ]);
    expect(issues(frame)).toEqual([{ kind: 'key', path: ['strokes', 0, 'taper'] }]);
  });

  it('finds values of enumerations it does not know, and says when the card does not validate', () => {
    const doc = createBoardDoc(boardId);
    const scene = add(doc, { type: 'scene', number: '1', title: '' });
    scene.set('setting', 'studio');
    expect(checkCard(scene)).toEqual({
      status: 'foreign',
      readable: false,
      issues: [
        { kind: 'value', path: ['setting'], value: 'studio' },
        { kind: 'invalid', path: [] },
      ],
    });

    // Plans leave out the items they cannot read: still shown, not to be edited.
    const plan = add(doc, { type: 'plan' });
    const icon = (kind: string, x = 10) =>
      new Y.Map<unknown>(Object.entries({ id: nextId(), kind, color: '#202020', x, y: 10 }));
    (plan.get('icons') as Y.Array<unknown>).push([icon('crane2'), icon(PLAN_ICON_KINDS[0])]);
    expect(checkCard(plan)).toEqual({
      status: 'foreign',
      readable: true,
      issues: [{ kind: 'value', path: ['icons', 0, 'kind'], value: 'crane2' }],
    });
    // A wider range than this build allows: no unknown name, but an item left out.
    const wide = add(doc, { type: 'plan' });
    (wide.get('icons') as Y.Array<unknown>).push([icon('camera', 5000)]);
    expect(checkCard(wide)).toEqual({
      status: 'foreign',
      readable: true,
      issues: [{ kind: 'invalid', path: ['icons'] }],
    });

    const unknownType = new Y.Map<unknown>();
    roots(doc).elements.set('shotAAAAAAAA', unknownType);
    unknownType.set('type', 'shot');
    expect(checkCard(unknownType)).toMatchObject({
      status: 'foreign',
      readable: false,
      issues: [{ kind: 'value', path: ['type'], value: 'shot' }, { kind: 'invalid' }],
    });
  });

  it('finds nodes, marks and attributes of note bodies it does not know', () => {
    const doc = createBoardDoc(boardId);
    const note = add(doc, { type: 'note' });
    const body = note.get('body') as Y.XmlFragment;
    const p = new Y.XmlElement('paragraph');
    p.setAttribute('textAlign', 'center');
    const text = new Y.XmlText();
    p.insert(0, [text]);
    const mention = new Y.XmlElement('mention');
    mention.setAttribute('id', 'u1');
    mention.setAttribute('label', 'Anna');
    p.insert(1, [mention]);
    body.insert(0, [p]);
    text.insert(0, 'Uno ', { bold: {}, 'noteInk--AbCd1234': { color: 'blue' } });
    expect(checkCard(note)).toEqual({ status: 'known' });

    text.insert(4, 'due', { glow: {} });
    p.setAttribute('indent', '2' as never);
    const callout = new Y.XmlElement('callout');
    body.insert(1, [callout]);
    text.insert(7, 'tre', { link: { href: 'https://example.com', preview: true } });
    expect(checkNoteBody(body)).toEqual([
      { kind: 'attribute', path: [0], name: 'paragraph.indent' },
      { kind: 'mark', path: [0, 0], name: 'glow' },
      { kind: 'attribute', path: [0, 0], name: 'link.preview' },
      { kind: 'node', path: [1], name: 'callout' },
    ]);
    expect(checkCard(note)).toMatchObject({ status: 'foreign', readable: true });
  });

  it('keeps its result until the card or anything inside it changes', () => {
    const doc = createBoardDoc(boardId);
    const plan = add(doc, { type: 'plan' });
    const icons = plan.get('icons') as Y.Array<Y.Map<unknown>>;
    icons.push([
      new Y.Map<unknown>(
        Object.entries({ id: nextId(), kind: 'sofa', color: '#202020', x: 1, y: 1 }),
      ),
    ]);
    const first = checkCard(plan);
    expect(first).toEqual({ status: 'known' });
    expect(checkCard(plan)).toBe(first);

    icons.get(0).set('elevation', 2);
    const second = checkCard(plan);
    expect(second).toEqual({
      status: 'foreign',
      readable: true,
      issues: [{ kind: 'key', path: ['icons', 0, 'elevation'] }],
    });
    expect(checkCard(plan)).toBe(second);
    icons.get(0).delete('elevation');
    expect(checkCard(plan)).toEqual({ status: 'known' });

    // Inside a transaction too, and for types created in it.
    doc.transact(() => {
      const note = add(doc, { type: 'note' });
      expect(checkCard(note)).toEqual({ status: 'known' });
      (note.get('body') as Y.XmlFragment).insert(0, [new Y.XmlElement('callout')]);
      expect(issues(note)).toEqual([{ kind: 'node', path: ['body', 0], name: 'callout' }]);
      icons.get(0).set('kind', 'crane2');
      expect(isForeignCard(plan)).toBe(true);
    });
    const text = new Y.XmlText();
    const note = add(doc, { type: 'note' });
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [text]);
    (note.get('body') as Y.XmlFragment).insert(0, [p]);
    expect(isForeignCard(note)).toBe(false);
    text.insert(0, 'x', { glow: {} });
    expect(issues(note)).toEqual([{ kind: 'mark', path: ['body', 0, 0], name: 'glow' }]);
  });

  it('follows updates from another client and undo', () => {
    const doc = createBoardDoc(boardId);
    const note = add(doc, { type: 'note' });
    const id = note.get('id') as string;
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    expect(checkCard(note)).toEqual({ status: 'known' });
    const before = Y.encodeStateVector(remote);
    roots(remote).elements.get(id)?.set('pinned', true);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, before));
    expect(issues(note)).toEqual([{ kind: 'key', path: ['pinned'] }]);

    const undo = new Y.UndoManager(roots(doc).elements, { trackedOrigins: new Set(['local']) });
    doc.transact(() => note.delete('pinned'), 'local');
    expect(isForeignCard(note)).toBe(false);
    undo.undo();
    expect(issues(note)).toEqual([{ kind: 'key', path: ['pinned'] }]);
    undo.redo();
    expect(isForeignCard(note)).toBe(false);
  });
});
